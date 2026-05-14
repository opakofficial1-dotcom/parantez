require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ── MIDDLEWARE ──────────────────────────────────────
app.use(cors({ 
  origin: process.env.FRONTEND_URL?.split(',') || '*',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  message: 'Trop de requêtes, attends un peu'
});
app.use(limiter);

// ── SUPABASE (serveur) ──────────────────────────────
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const BUCKET = 'audio';

// ── AUTH MIDDLEWARE ─────────────────────────────────
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'default-token-change-me';

function checkAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
}

// ── VALIDATION ──────────────────────────────────────
function sanitize(str) {
  return String(str).trim().substring(0, 500).replace(/[<>]/g, '');
}

// ── ROUTES ──────────────────────────────────────────

// GET /api/tracks - Publique (lecture)
app.get('/api/tracks', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const { data, error, count } = await sb
      .from('tracks')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      data: data || [],
      page,
      limit,
      total: count || 0
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tracks/:id - Publique
app.get('/api/tracks/:id', async (req, res) => {
  try {
    const { data, error } = await sb
      .from('tracks')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(404).json({ error: 'Track non trouvée' });
  }
});

// POST /api/tracks - Protégé (ajout)
app.post('/api/tracks', checkAuth, async (req, res) => {
  try {
    const { title, feat, duration, file_url } = req.body;

    // Validation
    if (!title || title.length < 2 || title.length > 500) {
      return res.status(400).json({ error: 'Titre invalide' });
    }
    if (duration && (isNaN(duration) || duration < 0 || duration > 36000)) {
      return res.status(400).json({ error: 'Durée invalide' });
    }
    if (!file_url || !file_url.startsWith('http')) {
      return res.status(400).json({ error: 'URL fichier invalide' });
    }

    const { data, error } = await sb.from('tracks').insert({
      title: sanitize(title),
      feat: feat ? sanitize(feat) : null,
      file_url: sanitize(file_url),
      duration: duration || 0,
      plays: 0
    }).select().single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de l\'ajout' });
  }
});

// DELETE /api/tracks/:id - Protégé
app.delete('/api/tracks/:id', checkAuth, async (req, res) => {
  try {
    const { error } = await sb
      .from('tracks')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur suppression' });
  }
});

// PATCH /api/tracks/:id/plays - Incrémenter écoutes (publique)
app.patch('/api/tracks/:id/plays', async (req, res) => {
  try {
    const { data: track, error: getError } = await sb
      .from('tracks')
      .select('plays')
      .eq('id', req.params.id)
      .single();

    if (getError) throw getError;

    const { data, error } = await sb
      .from('tracks')
      .update({ plays: (track.plays || 0) + 1 })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur mise à jour' });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Route non trouvée' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));