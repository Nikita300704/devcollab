import { Suspense } from "react";
import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
          <main className="auth-page">
      <Suspense fallback={<p>Loading...</p>}>
        <SignUp />
      </Suspense>
    </main>
  );
}