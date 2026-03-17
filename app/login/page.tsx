"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginRequest, setToken } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params?.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const validate = () => {
    setError(null);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email.");
      return false;
    }
    if (!password || password.length < 6) {
      setError("Password must be at least 6 characters.");
      return false;
    }
    return true;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setError(null);
    try {
      await loginRequest(email, password);
      router.push(next);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-md border p-6 bg-white">
        <h2 className="text-xl font-semibold mb-4">Sign in</h2>
        {error && <div className="mb-3 text-sm text-red-700">{error}</div>}
        <form onSubmit={onSubmit}>
          <label className="block text-sm">Email</label>
          <input
            className="w-full mb-3 rounded border px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            required
          />

          <label className="block text-sm">Password</label>
          <input
            className="w-full mb-4 rounded border px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            required
          />

          <button
            type="submit"
            className="w-full rounded bg-blue-600 py-2 text-white"
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-4 text-sm">
          Don't have an account?{" "}
          <a href="/register" className="text-blue-600">
            Register
          </a>
        </div>
      </div>
    </div>
  );
}
