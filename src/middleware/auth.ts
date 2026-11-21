import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser, type AuthenticatedDbUser } from '../db/users.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  dbUser?: AuthenticatedDbUser;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing authentication token' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Unauthorized: Empty authentication token' });
    return;
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    if (!decodedToken.email) {
      res.status(401).json({ error: 'Unauthorized: Verified email is required' });
      return;
    }

    const dbUser = await getOrCreateUser(
      decodedToken.uid,
      decodedToken.email,
      typeof decodedToken.name === 'string' ? decodedToken.name : null
    );

    if (!dbUser.isActive) {
      res.status(403).json({ error: 'Account is deactivated. Contact Warehouse Admin.' });
      return;
    }

    req.user = decodedToken;
    req.dbUser = dbUser;
    next();
  } catch (error) {
    console.error('Authentication verification failed:', error);
    res.status(401).json({ error: 'Unauthorized: Invalid or expired session token' });
  }
};

export const requireRole = (...allowedRoleCodes: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const roleCode = req.dbUser?.roleCode;
    if (!roleCode || !allowedRoleCodes.includes(roleCode)) {
      res.status(403).json({
        error: `Forbidden: Requires role ${allowedRoleCodes.join(' or ')}`,
      });
      return;
    }
    next();
  };
};
