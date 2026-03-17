"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { registerRequest, loginRequest, setToken } from "@/lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params?.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
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
    if (phone && !/^\+?[0-9\-\s()]{6,20}$/.test(phone)) {
      setError("Please enter a valid phone number.");
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
      // send registration payload
      await registerRequest({
        email,
        password,
        name: name || undefined,
        phone: phone || undefined,
      });

      // auto-login after successful registration
      const res = await loginRequest(email, password);
      const token =
        res?.data?.token ||
        res?.data?.accessToken ||
        res?.headers?.authorization;
      if (token) {
        const raw = String(token).replace(/^Bearer\s+/i, "");
        setToken(raw);
      }

      router.push(next);
    } catch (err: any) {
      setError(
        err?.response?.data?.message || err?.message || "Registration failed",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-md border p-6 bg-white">
        <h2 className="text-xl font-semibold mb-4">Create account</h2>
        {error && <div className="mb-3 text-sm text-red-700">{error}</div>}
        <form onSubmit={onSubmit}>
          <label className="block text-sm">Email</label>
          <input
            className="w-full mb-3 rounded border px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />

          <label className="block text-sm">Password</label>
          <input
            className="w-full mb-3 rounded border px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />

          <label className="block text-sm">Name (optional)</label>
          <input
            className="w-full mb-3 rounded border px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            type="text"
          />

          <label className="block text-sm">Phone (optional)</label>
          <input
            className="w-full mb-4 rounded border px-3 py-2"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
          />

          <button
            type="submit"
            className="w-full rounded bg-blue-600 py-2 text-white"
            disabled={loading}
          >
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>

        <div className="mt-4 text-sm">
          Already have an account?{" "}
          <a href="/login" className="text-blue-600">
            Sign in
          </a>
        </div>
      </div>
    </div>
  );
}
