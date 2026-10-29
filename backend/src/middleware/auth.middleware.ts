import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.token;
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        error: { code: "MISSING_TOKEN", details: null }
      });
    }

    const decoded = verifyToken(token);
    req.user = { id: decoded.id };
    
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
      error: { code: "INVALID_TOKEN", details: null }
    });
  }
};
