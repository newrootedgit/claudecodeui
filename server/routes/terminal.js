import { Router } from 'express';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { terminalSessionsDb } from '../database/db.js';

const router = Router();

// Check if tmux is available
function isTmuxAvailable() {
  try {
    execSync('which tmux', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Check if a tmux session exists
function tmuxSessionExists(sessionId) {
  try {
    execSync(`tmux has-session -t "${sessionId}" 2>/dev/null`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// List running tmux sessions
function listTmuxSessions() {
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf-8' });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// GET /api/terminal/capabilities - Check tmux availability
router.get('/capabilities', (req, res) => {
  res.json({ tmuxAvailable: isTmuxAvailable() });
});

// GET /api/terminal - List terminal sessions
router.get('/', (req, res) => {
  try {
    const { projectPath } = req.query;
    const sessions = projectPath
      ? terminalSessionsDb.getSessions(projectPath)
      : terminalSessionsDb.getAllSessions();

    const aliveSessions = listTmuxSessions();

    const result = sessions.map(s => ({
      sessionId: s.session_id,
      projectPath: s.project_path,
      terminalName: s.terminal_name,
      createdAt: s.created_at,
      lastActivity: s.last_activity,
      tmuxAlive: aliveSessions.includes(s.session_id),
    }));

    res.json(result);
  } catch (error) {
    console.error('[Terminal] Error listing sessions:', error);
    res.status(500).json({ error: 'Failed to list terminal sessions' });
  }
});

// POST /api/terminal - Create a new terminal session
router.post('/', (req, res) => {
  try {
    const { projectPath, terminalName } = req.body;
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const sessionId = `term_${crypto.randomBytes(8).toString('hex')}`;
    const name = terminalName || 'Terminal';
    const userId = req.user?.id || null;

    // Create tmux session
    try {
      execSync(
        `tmux new-session -d -s "${sessionId}" -c "${projectPath}" -x 120 -y 30`,
        { stdio: 'ignore' }
      );
    } catch (tmuxErr) {
      console.error('[Terminal] Failed to create tmux session:', tmuxErr);
      return res.status(500).json({ error: 'Failed to create tmux session' });
    }

    // Save to database
    const record = terminalSessionsDb.createSession(sessionId, userId, projectPath, name);

    res.json({
      sessionId: record.sessionId,
      projectPath,
      terminalName: name,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      tmuxAlive: true,
    });
  } catch (error) {
    console.error('[Terminal] Error creating session:', error);
    res.status(500).json({ error: 'Failed to create terminal session' });
  }
});

// PATCH /api/terminal/:sessionId - Rename a terminal session
router.patch('/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const { terminalName } = req.body;
    if (!terminalName) {
      return res.status(400).json({ error: 'terminalName is required' });
    }

    const updated = terminalSessionsDb.renameSession(sessionId, terminalName);
    if (!updated) {
      return res.status(404).json({ error: 'Terminal session not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Terminal] Error renaming session:', error);
    res.status(500).json({ error: 'Failed to rename terminal session' });
  }
});

// DELETE /api/terminal/:sessionId - Delete a terminal session
router.delete('/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;

    // Kill tmux session if it exists
    if (tmuxSessionExists(sessionId)) {
      try {
        execSync(`tmux kill-session -t "${sessionId}"`, { stdio: 'ignore' });
      } catch {
        // Ignore kill errors
      }
    }

    // Soft-delete from database
    const deleted = terminalSessionsDb.deleteSession(sessionId);
    if (!deleted) {
      return res.status(404).json({ error: 'Terminal session not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Terminal] Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete terminal session' });
  }
});

export default router;
