import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-langcurve-production-2026';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: 'USER' | 'ADMIN';
  };
}

// Authentication Middleware to verify incoming JWT tokens
export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Expecting "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: 'Access token is missing.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Access token is invalid or expired.' });
    }
    req.user = decoded as AuthRequest['user'];
    next();
  });
}

// Role-Based Access Control (RBAC) Authorization Middleware
export function requireRole(allowedRole: 'USER' | 'ADMIN') {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User is not authenticated.' });
    }

    // ADMIN has bypass privileges
    if (req.user.role !== allowedRole && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied: insufficient permissions.' });
    }

    next();
  };
}
