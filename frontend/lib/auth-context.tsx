"use client";

/**
 * Thin client-side auth context.
 *
 * Holds the current `user` for client components and exposes `login`, `register`,
 * and `logout`, which delegate to the server actions in lib/actions/auth.ts.
 * The user is seeded from the server (see the root layout), so there is no
 * client-side fetch-on-mount and therefore no loading flash — `isLoading` is kept
 * for API compatibility but is always `false` in this SSR-seeded model.
 */
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { signIn, signOut, signUp, type SignInInput, type SignUpInput } from "@/lib/actions/auth";
import type { ActionResponse, User } from "@/lib/types";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  login: (data: SignInInput) => Promise<ActionResponse>;
  register: (data: SignUpInput) => Promise<ActionResponse>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ initialUser, children }: { initialUser: User | null; children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(initialUser);

  // User is resolved on the server and passed in, so nothing loads on the client.
  const isLoading = false;

  const login = useCallback(async (data: SignInInput) => {
    const result = await signIn(data);
    if (result.success && result.user) setUser(result.user);
    return result;
  }, []);

  const register = useCallback(async (data: SignUpInput) => {
    const result = await signUp(data);
    if (result.success && result.user) setUser(result.user);
    return result;
  }, []);

  const logout = useCallback(async () => {
    await signOut();
    setUser(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

/** Reads the auth context. Throws if used outside an `AuthProvider`. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
