import { Suspense } from "react";
import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
        <main className="auth-page">
      <Suspense fallback={<p>Loading...</p>}>
        <SignIn />
      </Suspense>
    </main>
  );
}