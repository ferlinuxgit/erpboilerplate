type AuthEmailPayload = {
  email: string;
  password: string;
  name?: string;
};

type AuthClientResult = {
  data: unknown | null;
  error: { message?: string } | null;
};

async function authRequest(path: string, payload?: AuthEmailPayload): Promise<AuthClientResult> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: data?.error ?? "No se pudo completar la autenticación." },
    };
  }

  return { data, error: null };
}

export const authClient = {
  signIn: {
    email: (payload: AuthEmailPayload) => authRequest("/api/auth/login", payload),
  },
  signUp: {
    email: (payload: Required<AuthEmailPayload>) => authRequest("/api/auth/register", payload),
  },
  signOut: () => authRequest("/api/auth/logout"),
};
