import express from 'express';

// BREAK_API=1 makes the API drift from openapi.yaml, so you can see what a contract failure looks like.
const broken = process.env.BREAK_API === '1';

export function createApp() {
  const app = express();
  app.get('/api/v1/users/:id', (req, res) => {
    if (req.params.id === '404') return res.status(404).json({ message: 'No such user' });
    if (!broken) res.set('X-Request-Id', 'req-1');
    res.json({ id: req.params.id, email: broken ? 42 : 'ada@example.com' });
  });
  return app;
}
