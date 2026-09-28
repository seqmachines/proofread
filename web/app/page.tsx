import { Suspense } from "react";
import { StartPage } from "@/components/StartPage";

export default function Home() {
  // StartPage reads ?protocol= via useSearchParams, which needs a Suspense boundary for prerendering.
  return (
    <Suspense fallback={null}>
      <StartPage />
    </Suspense>
  );
}
