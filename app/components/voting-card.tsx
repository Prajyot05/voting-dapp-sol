"use client";

import { useState, useCallback, useMemo } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { Voting } from "@/anchor/target/types/voting";
const IDL = require("@/anchor/target/idl/voting.json");

const PROGRAM_ID = new PublicKey("DHt4nNcMmkc1BGtkxPyPJm656ScJdrcQJzPhsLURTEY3");

// ---------- User-friendly error parsing ----------

function parseAnchorError(err: any): string {
  // User rejected the wallet popup
  if (err?.name === "WalletSignTransactionError" || err?.message?.includes("User rejected"))
    return "Transaction cancelled.";

  const logs: string[] = err?.logs ?? [];
  const logStr = logs.join(" ");

  // System program 0x0 = account already in use (init on an existing PDA)
  if (logStr.includes("already in use") || logStr.includes("custom program error: 0x0")) {
    // Could be a duplicate poll, candidate, or a repeat vote
    if (logStr.includes("receipt") || err?.message?.includes("vote"))
      return "You have already voted in this poll.";
    return "That account already exists. The poll or candidate was already created — try a different ID or name.";
  }

  // Anchor constraint violations surface as 0x177x codes
  if (logStr.includes("custom program error: 0x177"))
    return "Voting period is not active. Check the poll start/end times.";

  if (logStr.includes("insufficient funds"))
    return "Insufficient SOL. Top up your wallet on devnet (faucet.solana.com).";

  if (logStr.includes("AccountNotInitialized") || logStr.includes("Account does not exist"))
    return "Poll not found. Make sure the poll ID exists and was initialized first.";

  // Generic simulation failure — log the full error but show a clean message
  if (err?.message?.includes("Simulation failed") || err?.message?.includes("Transaction simulation failed"))
    return "Transaction failed. Check the browser console for details.";

  return err?.message ?? "An unknown error occurred.";
}

// ---------- RPC helper for raw account reads (used in poll lookup) ----------

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

interface PollData {
  pollId: number;
  description: string;
  candidateAmount: number;
}

interface CandidateData {
  candidateName: string;
  candidateVotes: number;
}

// ---------- Component ----------

type Tab = "create" | "candidates" | "vote";

export function VotingCard() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const program = useMemo(() => {
    if (!wallet.publicKey) return null;
    // AnchorProvider needs a wallet with signTransaction + signAllTransactions.
    // wallet-adapter's useWallet() satisfies this interface.
    const provider = new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
    return new Program<Voting>(IDL, provider);
  }, [connection, wallet]);

  const [activeTab, setActiveTab] = useState<Tab>("create");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Create Poll form
  const [pollId, setPollId] = useState("");
  const [description, setDescription] = useState("");
  const [pollStart, setPollStart] = useState("");
  const [pollEnd, setPollEnd] = useState("");

  // Add Candidate form
  const [candPollId, setCandPollId] = useState("");
  const [candidateName, setCandidateName] = useState("");

  // Vote form
  const [votePollId, setVotePollId] = useState("");
  const [voteCandidateName, setVoteCandidateName] = useState("");

  // Lookup results
  const [pollData, setPollData] = useState<PollData | null>(null);
  const [candidates, setCandidates] = useState<CandidateData[]>([]);
  const [candidateNames, setCandidateNames] = useState<string[]>([]);

  // --- Create Poll ---
  const handleCreatePoll = useCallback(async () => {
    if (!program || !wallet.publicKey || !pollId || !description) return;
    try {
      setIsSending(true);
      setTxStatus("Awaiting signature...");
      const id = new BN(pollId);
      const start = pollStart
        ? new BN(Math.floor(new Date(pollStart).getTime() / 1000))
        : new BN(0);
      const end = pollEnd
        ? new BN(Math.floor(new Date(pollEnd).getTime() / 1000))
        : new BN(Math.floor(Date.now() / 1000) + 86400 * 30);

      const sig = await program.methods
        .initializePoll(id, description, start, end)
        .rpc();

      setTxStatus(`Poll created! Tx: ${sig.slice(0, 20)}...`);
      setPollId("");
      setDescription("");
      setPollStart("");
      setPollEnd("");
    } catch (err: any) {
      console.error(err);
      setTxStatus(`Error: ${parseAnchorError(err)}`);
    } finally {
      setIsSending(false);
    }
  }, [program, wallet.publicKey, pollId, description, pollStart, pollEnd]);

  // --- Add Candidate ---
  const handleAddCandidate = useCallback(async () => {
    if (!program || !wallet.publicKey || !candPollId || !candidateName) return;
    try {
      setIsSending(true);
      setTxStatus("Awaiting signature...");
      const id = new BN(candPollId);

      const sig = await program.methods
        .initializeCandidate(candidateName, id)
        .rpc();

      setTxStatus(`Candidate added! Tx: ${sig.slice(0, 20)}...`);
      setCandidateNames((prev) =>
        prev.includes(candidateName) ? prev : [...prev, candidateName]
      );
      setCandidateName("");
    } catch (err: any) {
      console.error(err);
      setTxStatus(`Error: ${parseAnchorError(err)}`);
    } finally {
      setIsSending(false);
    }
  }, [program, wallet.publicKey, candPollId, candidateName]);

  // --- Vote ---
  const handleVote = useCallback(async () => {
    if (!program || !wallet.publicKey || !votePollId || !voteCandidateName)
      return;
    try {
      setIsSending(true);
      setTxStatus("Awaiting signature...");
      const id = new BN(votePollId);

      const sig = await program.methods
        .vote(voteCandidateName, id)
        .rpc();

      setTxStatus(`Vote cast! Tx: ${sig.slice(0, 20)}...`);
      setCandidateNames((prev) =>
        prev.includes(voteCandidateName) ? prev : [...prev, voteCandidateName]
      );
    } catch (err: any) {
      console.error(err);
      setTxStatus(`Error: ${parseAnchorError(err)}`);
    } finally {
      setIsSending(false);
    }
  }, [program, wallet.publicKey, votePollId, voteCandidateName]);

  // --- Fetch poll + candidate info ---
  const handleFetchPoll = useCallback(
    async (id: string) => {
      if (!program || !id) return;
      try {
        const pollIdBN = new BN(id);
        const pollIdBytes = pollIdBN.toArrayLike(Buffer, "le", 8);

        const [pollPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("poll"), pollIdBytes],
          PROGRAM_ID
        );
        const pollAcc = await program.account.poll.fetch(pollPda);
        setPollData({
          pollId: pollAcc.pollId.toNumber(),
          description: pollAcc.description,
          candidateAmount: pollAcc.candidateAmount.toNumber(),
        });

        // Fetch every Candidate account owned by the program, then keep only
        // the ones that belong to this poll. We verify membership by re-deriving
        // the PDA from [poll_id_le, candidate_name] and comparing to the
        // account's on-chain address — no extra on-chain changes needed.
        const allCandidates = await program.account.candidate.all();
        const pollCandidates: CandidateData[] = [];
        for (const { publicKey, account } of allCandidates) {
          const [expectedPda] = PublicKey.findProgramAddressSync(
            [pollIdBytes, Buffer.from(account.candidateName)],
            PROGRAM_ID
          );
          if (expectedPda.equals(publicKey)) {
            pollCandidates.push({
              candidateName: account.candidateName,
              candidateVotes: account.candidateVotes.toNumber(),
            });
          }
        }
        setCandidates(pollCandidates);
      } catch (err) {
        console.error(err);
        setPollData(null);
        setCandidates([]);
      }
    },
    [program]
  );

  if (!wallet.connected) {
    return (
      <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="space-y-1">
          <p className="text-lg font-semibold">Voting Program</p>
          <p className="text-sm text-muted">
            Connect your wallet to create polls, add candidates, and vote.
          </p>
        </div>
        <WalletMultiButton className="!w-full !rounded-lg !bg-foreground !text-background !text-sm !font-medium !py-2.5" />
      </section>
    );
  }

  return (
    <section className="w-full max-w-3xl space-y-5 rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-lg font-semibold">Voting Program</p>
          <p className="text-sm text-muted">
            Create polls, register candidates, and cast your vote — all on-chain.
          </p>
        </div>
        <WalletMultiButton className="!rounded-lg !bg-foreground !text-background !text-sm !font-medium !py-2" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border-low bg-cream/30 p-1">
        {(["create", "candidates", "vote"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              setTxStatus(null);
            }}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition cursor-pointer ${
              activeTab === tab
                ? "bg-foreground text-background shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab === "candidates"
              ? "Add Candidate"
              : tab === "create"
              ? "Create Poll"
              : "Vote"}
          </button>
        ))}
      </div>

      {/* Create Poll */}
      {activeTab === "create" && (
        <div className="space-y-3">
          <input
            type="number"
            min="1"
            placeholder="Poll ID (unique number)"
            value={pollId}
            onChange={(e) => setPollId(e.target.value)}
            disabled={isSending}
            className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
          />
          <input
            type="text"
            placeholder="Description (max 280 chars)"
            maxLength={280}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSending}
            className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted">
                Start (optional)
              </label>
              <input
                type="datetime-local"
                value={pollStart}
                onChange={(e) => setPollStart(e.target.value)}
                disabled={isSending}
                className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition focus:border-foreground/30 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">
                End (optional)
              </label>
              <input
                type="datetime-local"
                value={pollEnd}
                onChange={(e) => setPollEnd(e.target.value)}
                disabled={isSending}
                className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition focus:border-foreground/30 disabled:opacity-60"
              />
            </div>
          </div>
          <button
            onClick={handleCreatePoll}
            disabled={isSending || !pollId || !description}
            className="w-full rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSending ? "Creating..." : "Create Poll"}
          </button>
        </div>
      )}

      {/* Add Candidate */}
      {activeTab === "candidates" && (
        <div className="space-y-3">
          <input
            type="number"
            min="1"
            placeholder="Poll ID"
            value={candPollId}
            onChange={(e) => setCandPollId(e.target.value)}
            disabled={isSending}
            className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
          />
          <input
            type="text"
            placeholder="Candidate name (max 32 chars)"
            maxLength={32}
            value={candidateName}
            onChange={(e) => setCandidateName(e.target.value)}
            disabled={isSending}
            className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
          />
          <button
            onClick={handleAddCandidate}
            disabled={isSending || !candPollId || !candidateName}
            className="w-full rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSending ? "Adding..." : "Add Candidate"}
          </button>
        </div>
      )}

      {/* Vote */}
      {activeTab === "vote" && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <input
              type="number"
              min="1"
              placeholder="Poll ID"
              value={votePollId}
              onChange={(e) => setVotePollId(e.target.value)}
              disabled={isSending}
              className="flex-1 rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
            />
            <button
              onClick={() => handleFetchPoll(votePollId)}
              disabled={!votePollId || !program}
              className="rounded-lg border border-border-low bg-cream px-4 py-2.5 text-sm font-medium transition hover:opacity-80 disabled:opacity-40 cursor-pointer"
            >
              Lookup
            </button>
          </div>

          {/* Poll info */}
          {pollData && (
            <div className="rounded-xl border border-border-low bg-cream/30 p-4 space-y-2">
              <p className="text-sm font-medium">
                Poll #{pollData.pollId}: {pollData.description}
              </p>
              <p className="text-xs text-muted">
                Candidates registered: {pollData.candidateAmount}
              </p>
              {candidates.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {candidates.map((c) => (
                    <div
                      key={c.candidateName}
                      className="flex items-center justify-between rounded-lg bg-card px-3 py-2 text-sm border border-border-low"
                    >
                      <span className="font-medium">{c.candidateName}</span>
                      <span className="tabular-nums text-muted">
                        {c.candidateVotes}{" "}
                        {c.candidateVotes === 1 ? "vote" : "votes"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <input
            type="text"
            placeholder="Candidate name to vote for"
            value={voteCandidateName}
            onChange={(e) => setVoteCandidateName(e.target.value)}
            disabled={isSending}
            className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
          />
          <button
            onClick={handleVote}
            disabled={isSending || !votePollId || !voteCandidateName}
            className="w-full rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSending ? "Voting..." : "Cast Vote"}
          </button>
        </div>
      )}

      {/* Transaction status */}
      {txStatus && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            txStatus.startsWith("Error")
              ? "bg-red-500/10 text-red-500"
              : "bg-cream/50 text-muted"
          }`}
        >
          {txStatus}
        </div>
      )}
    </section>
  );
}


