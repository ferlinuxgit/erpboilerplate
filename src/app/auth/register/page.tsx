import { AuthForm } from "@/components/auth-form";

export default function RegisterPage() {
  return (
    <main className="container mx-auto flex min-h-[80vh] items-center px-4 py-10">
      <AuthForm mode="sign-up" />
    </main>
  );
}
