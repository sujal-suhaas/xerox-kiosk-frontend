"use client";

import axios from "axios";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "";

export const axiosInstance = axios.create({
  baseURL: BACKEND,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: false,
});

axiosInstance.interceptors.request.use((config) => {
  try {
    const token = getToken();
    if (token) {
      config.headers = config.headers || {};
      (config.headers as Record<string, string>)["Authorization"] =
        `Bearer ${token}`;
    }
  } catch (e) {}
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      clearToken();
      if (typeof window !== "undefined") {
        const nextPath = window.location.pathname + window.location.search;
        window.location.href = `/login?next=${encodeURIComponent(nextPath)}`;
      }
    }
    return Promise.reject(error);
  },
);

export const getToken = () => {
  try {
    return typeof window !== "undefined"
      ? localStorage.getItem("authToken")
      : null;
  } catch {
    return null;
  }
};

export const setToken = (token: string) => {
  try {
    localStorage.setItem("authToken", token);
  } catch (e) {
    // ignore
  }
};

export const clearToken = () => {
  try {
    localStorage.removeItem("authToken");
  } catch (e) {
    // ignore
  }
};

export const isAuthenticated = () => Boolean(getToken());

export async function loginRequest(email: string, password: string) {
  const res = await axiosInstance.post(`/auth/login`, { email, password });
  const token = res?.data?.access_token;
  if (token) setToken(token);
  return res;
}

export async function registerRequest(payload: Record<string, any>) {
  // axiosInstance will include Authorization header if token already set
  return axiosInstance.post(`/auth/register`, payload);
}

export async function logoutRequest() {
  try {
    await axiosInstance.post(`/auth/logout`);
  } catch (e) {
    // ignore server errors
  }
  clearToken();
}

export default axiosInstance;
