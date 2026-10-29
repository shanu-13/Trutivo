import { API_URL, apiClient } from './client';

export const getMe = async () => {
  return apiClient('/auth/me');
};

export const logoutUser = async () => {
  return apiClient('/auth/logout', { method: 'POST' });
};

export const loginUser = async (credentials: any) => {
  return apiClient('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials)
  });
};

export const registerUser = async (userData: any) => {
  return fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData),
    credentials: 'omit'
  }).then(res => res.json());
};
