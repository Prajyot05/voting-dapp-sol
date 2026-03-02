"use client";
import { VotingCard } from "./components/voting-card";

export default function Home() {
  return (
    <div className="relative min-h-[93vh] overflow-x-clip bg-bg1 text-foreground">
      <main className="relative z-10 mx-auto flex min-h-[93vh] max-w-4xl flex-col gap-10 border-x border-border-low px-6 py-16">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.18em] text-muted">
            On-chain voting
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Solana Voting dApp
          </h1>
          <p className="max-w-3xl text-base leading-relaxed text-muted">
            Create polls, register candidates, and cast votes — all stored
            on-chain via an Anchor program on Solana devnet.
          </p>
        </header>

        <VotingCard />
      </main>
    </div>
  );
}


