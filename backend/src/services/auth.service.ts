import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';

export const createUser = async (name: string, email: string, passwordHash: string) => {
  const id = uuidv4();
  await pool.execute(
    'INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
    [id, name, email, passwordHash]
  );
  return id;
};

export const getUserByEmail = async (email: string) => {
  const [rows]: any = await pool.execute(
    'SELECT * FROM users WHERE email = ?',
    [email]
  );
  return rows[0] || null;
};

export const getUserById = async (id: string) => {
  const [rows]: any = await pool.execute(
    'SELECT id, name, email, created_at, updated_at FROM users WHERE id = ?',
    [id]
  );
  return rows[0] || null;
};
