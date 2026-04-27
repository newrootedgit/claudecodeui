import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { userDb, db } from '../database/db.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// =====================================================
// Rate Limiting — 5 attempts, then 15-min lockout
// =====================================================
const loginAttempts = new Map(); // ip -> { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function checkRateLimit(ip) {
    const record = loginAttempts.get(ip);
    if (!record) return { allowed: true, remaining: MAX_ATTEMPTS };
    if (record.lockedUntil && Date.now() < record.lockedUntil) {
        const minutesLeft = Math.ceil((record.lockedUntil - Date.now()) / 60000);
        return { allowed: false, remaining: 0, minutesLeft };
    }
    if (record.lockedUntil && Date.now() >= record.lockedUntil) {
        loginAttempts.delete(ip);
        return { allowed: true, remaining: MAX_ATTEMPTS };
    }
    return { allowed: true, remaining: MAX_ATTEMPTS - record.count };
}

function recordFailedAttempt(ip) {
    const record = loginAttempts.get(ip) || { count: 0 };
    record.count++;
    if (record.count >= MAX_ATTEMPTS) {
        record.lockedUntil = Date.now() + (LOCKOUT_MINUTES * 60 * 1000);
    }
    loginAttempts.set(ip, record);
    return MAX_ATTEMPTS - record.count;
}

function clearAttempts(ip) {
    loginAttempts.delete(ip);
}

// =====================================================
// Password Reset Tokens — in-memory, expire in 15 min
// =====================================================
const resetTokens = new Map();
const RESET_TOKEN_EXPIRY_MINUTES = 15;

function createResetToken(userId, email) {
    const token = crypto.randomBytes(32).toString('hex');
    resetTokens.set(token, {
        userId,
        email,
        expiresAt: Date.now() + (RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000)
    });
    for (const [t, data] of resetTokens) {
        if (Date.now() > data.expiresAt) resetTokens.delete(t);
    }
    return token;
}

function validateResetToken(token) {
    const data = resetTokens.get(token);
    if (!data) return null;
    if (Date.now() > data.expiresAt) {
        resetTokens.delete(token);
        return null;
    }
    return data;
}

// =====================================================
// Email sending via Gmail OAuth2
// =====================================================
async function sendResetEmail(toEmail, resetToken) {
    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            type: 'OAuth2',
            user: process.env.GMAIL_USER_EMAIL,
            clientId: process.env.GMAIL_CLIENT_ID,
            clientSecret: process.env.GMAIL_CLIENT_SECRET,
            refreshToken: process.env.GMAIL_REFRESH_TOKEN,
        }
    });
    const resetUrl = 'https://assistant.rootedrobotics.com/reset-password?token=' + resetToken;
    await transporter.sendMail({
        from: '"Rooted Robotics Assistant" <' + process.env.GMAIL_USER_EMAIL + '>',
        to: toEmail,
        subject: 'Password Reset - Rooted Robotics AI Assistant',
        html: '<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">'
            + '<h2 style="color: #1a1a1a;">Password Reset</h2>'
            + '<p>A password reset was requested for the AI Assistant at assistant.rootedrobotics.com.</p>'
            + '<p>Click the link below to set a new password. This link expires in ' + RESET_TOKEN_EXPIRY_MINUTES + ' minutes.</p>'
            + '<p style="margin: 24px 0;"><a href="' + resetUrl + '" style="background: #00d47e; color: #0a0f0d; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Reset Password</a></p>'
            + '<p style="color: #666; font-size: 13px;">If you did not request this, you can ignore this email.</p>'
            + '</div>'
    });
}

// =====================================================
// Routes
// =====================================================

router.get('/status', async (req, res) => {
    try {
        const hasUsers = await userDb.hasUsers();
        res.json({ needsSetup: !hasUsers, isAuthenticated: false });
    } catch (error) {
        console.error('Auth status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        if (username.length < 3 || password.length < 6) {
            return res.status(400).json({ error: 'Username must be at least 3 characters, password at least 6 characters' });
        }
        db.prepare('BEGIN').run();
        try {
            const hasUsers = userDb.hasUsers();
            if (hasUsers) {
                db.prepare('ROLLBACK').run();
                return res.status(403).json({ error: 'User already exists. This is a single-user system.' });
            }
            const passwordHash = await bcrypt.hash(password, 12);
            const user = userDb.createUser(username, passwordHash);
            const token = generateToken(user);
            db.prepare('COMMIT').run();
            userDb.updateLastLogin(user.id);
            res.json({ success: true, user: { id: user.id, username: user.username }, token });
        } catch (error) {
            db.prepare('ROLLBACK').run();
            throw error;
        }
    } catch (error) {
        console.error('Registration error:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(409).json({ error: 'Username already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

router.post('/login', async (req, res) => {
    try {
        const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip;
        const rateCheck = checkRateLimit(ip);
        if (!rateCheck.allowed) {
            return res.status(429).json({
                error: 'Too many login attempts. Account locked for ' + rateCheck.minutesLeft + ' more minute(s). Try again later.',
                locked: true,
                minutesLeft: rateCheck.minutesLeft
            });
        }
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        const user = userDb.getUserByUsername(username);
        if (!user) {
            const remaining = recordFailedAttempt(ip);
            const msg = remaining > 0
                ? 'Invalid username or password. ' + remaining + ' attempt(s) remaining before lockout.'
                : 'Too many failed attempts. Account locked for ' + LOCKOUT_MINUTES + ' minutes.';
            return res.status(401).json({ error: msg, attemptsRemaining: Math.max(0, remaining) });
        }
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            const remaining = recordFailedAttempt(ip);
            const msg = remaining > 0
                ? 'Invalid username or password. ' + remaining + ' attempt(s) remaining before lockout.'
                : 'Too many failed attempts. Account locked for ' + LOCKOUT_MINUTES + ' minutes.';
            return res.status(401).json({ error: msg, attemptsRemaining: Math.max(0, remaining) });
        }
        clearAttempts(ip);
        const token = generateToken(user);
        userDb.updateLastLogin(user.id);
        res.json({ success: true, user: { id: user.id, username: user.username }, token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        const domain = email.split('@')[1];
        if (!domain || domain.toLowerCase() !== 'rootedrobotics.com') {
            return res.status(403).json({ error: 'Password reset is only available for @rootedrobotics.com email addresses.' });
        }
        // Always return success to prevent email enumeration
        const user = userDb.getFirstUser();
        if (user) {
            const token = createResetToken(user.id, email);
            try {
                await sendResetEmail(email, token);
                console.log('[AUTH] Password reset email sent to ' + email);
            } catch (emailErr) {
                console.error('[AUTH] Failed to send reset email:', emailErr.message);
            }
        }
        res.json({ success: true, message: 'If that email is associated with an account, a reset link has been sent.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token and new password are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        const tokenData = validateResetToken(token);
        if (!tokenData) {
            return res.status(400).json({ error: 'Invalid or expired reset token. Please request a new one.' });
        }
        const passwordHash = await bcrypt.hash(newPassword, 12);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, tokenData.userId);
        resetTokens.delete(token);
        console.log('[AUTH] Password reset completed for user ID ' + tokenData.userId + ' via ' + tokenData.email);
        res.json({ success: true, message: 'Password has been reset. You can now log in with your new password.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/user', authenticateToken, (req, res) => {
    res.json({ user: req.user });
});

router.post('/logout', authenticateToken, (req, res) => {
    res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
