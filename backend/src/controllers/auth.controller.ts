import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import * as authService from '../services/auth.service';
import { generateToken, SESSION_MAX_AGE_MS } from '../utils/jwt';
import { config } from '../config/env';

// Bounded to the database columns; bcrypt only uses the first 72 bytes of a password,
// so longer ones are refused rather than silently truncated.
export const registerSchema = z.object({
  name: z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .refine((s) => s.length >= 2, "Name must be at least 2 characters")
    .refine((s) => s.length <= 100, "Name must be at most 100 characters")
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "Name contains invalid characters"),
  email: z.string().trim().max(254, "Email must be at most 254 characters").email("Invalid email format"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .refine((s) => Buffer.byteLength(s, 'utf8') <= 72, "Password must be at most 72 bytes")
});

const loginSchema = z.object({
  email: z.string().trim().max(254, "Invalid email format").email("Invalid email format"),
  password: z.string().min(1, "Password is required").max(1024, "Invalid email or password")
});

// HTTP-only session cookie. Secure in production; SameSite is configurable for
// frontends and APIs on different sites (COOKIE_SAMESITE=none needs COOKIE_SECURE=true).
const cookieOptions = {
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: config.cookieSameSite,
  path: '/',
  maxAge: SESSION_MAX_AGE_MS
};
// clearCookie must match the cookie's attributes but not maxAge: in Express 4 maxAge overrides
// the immediate expiry, leaving an empty cookie behind for the whole session length.
const { maxAge: _maxAge, ...clearCookieOptions } = cookieOptions;

export const register = async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        error: { code: "VALIDATION_ERROR", details: parsed.error.format() }
      });
    }

    const { name, email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const existingUser = await authService.getUserByEmail(normalizedEmail);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
        error: { code: "EMAIL_ALREADY_EXISTS", details: null }
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = await authService.createUser(name, normalizedEmail, passwordHash);

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      data: {
        user: { id: userId, name, email: normalizedEmail }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Registration failed",
      error: { code: "SERVER_ERROR", details: null }
    });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        error: { code: "VALIDATION_ERROR", details: parsed.error.format() }
      });
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const user = await authService.getUserByEmail(normalizedEmail);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        error: { code: "UNAUTHORIZED", details: null }
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        error: { code: "UNAUTHORIZED", details: null }
      });
    }

    const token = generateToken(user.id);
    res.cookie('token', token, cookieOptions);

    res.json({
      success: true,
      message: "Login successful",
      data: {
        user: { id: user.id, name: user.name, email: user.email }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: { code: "SERVER_ERROR", details: null }
    });
  }
};

export const logout = (req: Request, res: Response) => {
  res.clearCookie('token', clearCookieOptions);
  res.json({
    success: true,
    message: "Logged out successfully",
    data: null
  });
};

export const getCurrentUser = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        error: { code: "UNAUTHORIZED", details: null }
      });
    }

    const user = await authService.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        error: { code: "NOT_FOUND", details: null }
      });
    }

    res.json({
      success: true,
      message: "User retrieved successfully",
      data: { user }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve user",
      error: { code: "SERVER_ERROR", details: null }
    });
  }
};
