"use client";

import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { clearPosOfflineData } from "@/lib/pos-offline-cache";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();

  const onSignOut = async () => {
    await authClient.signOut();
    clearPosOfflineData();
    router.push("/auth/login");
    router.refresh();
  };

  return (
    <Button onClick={onSignOut} variant="outline">
      Cerrar sesión
    </Button>
  );
}
