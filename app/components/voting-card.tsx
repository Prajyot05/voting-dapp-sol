"use client";

import { useState, useCallback } from "react";
import {
  useWalletConnection,
  useSendTransaction,
} from "@solana/react-hooks";
import {
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
} from "@solana/kit";

// Program ID from Anchor.toml / declare_id!
const VOTING_PROGRAM_ADDRESS =
  "DHt4nNcMmkc1BGtkxPyPJm656ScJdrcQJzPhsLURTEY3" as Address;
const SYSTEM_PROGRAM_ADDRESS =
  "11111111111111111111111111111111" as Address;

// Instruction discriminators from the IDL (first 8 bytes of sha256("global:<fn>"))
const INITIALIZE_POLL_DISC = new Uint8Array([193, 22, 99, 197, 18, 33, 115, 117]);
const INITIALIZE_CANDIDATE_DISC = new Uint8Array([210, 107, 118, 204, 255, 97, 112, 26]);
const VOTE_DISC = new Uint8Array([227, 110, 155, 23, 136, 126, 172, 25]);

// ---------- Borsh encoding helpers ----------

function encodeU64LE(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, value, true);
  return buf;
}

function encodeBorshString(s: string): Uint8Array {
  const strBytes = getUtf8Encoder().encode(s);
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, strBytes.length, true);
  const result = new Uint8Array(4 + strBytes.length);
  result.set(lenBuf);
  result.set(strBytes, 4);
  return result;
}

// ---------- PDA derivation ----------

async function getPollPda(pollId: bigint) {
  return getProgramDerivedAddress({
    programAddress: VOTING_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("poll"), encodeU64LE(pollId)],
  });
}

async function getCandidatePda(pollId: bigint, candidateName: string) {
  return getProgramDerivedAddress({
    programAddress: VOTING_PROGRAM_ADDRESS,
    seeds: [encodeU64LE(pollId), getUtf8Encoder().encode(candidateName)],
  });
}

// ---------- Instruction data builders ----------

function buildInitializePollData(
  pollId: bigint,
  description: string,
  pollStart: bigint,
  pollEnd: bigint
): Uint8Array {
  const parts = [
    INITIALIZE_POLL_DISC,
    encodeU64LE(pollId),
    encodeBorshString(description),
    encodeU64LE(pollStart),
    encodeU64LE(pollEnd),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    buf.set(p, offset);
    offset += p.length;
  }
  return buf;
}

function buildInitializeCandidateData(
  candidateName: string,
  pollId: bigint
): Uint8Array {
  const parts = [
    INITIALIZE_CANDIDATE_DISC,
    encodeBorshString(candidateName),
    encodeU64LE(pollId),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    buf.set(p, offset);
    offset += p.length;
  }
  return buf;
}

function buildVoteData(candidateName: string, pollId: bigint): Uint8Array {
  const parts = [
    VOTE_DISC,
    encodeBorshString(candidateName),
    encodeU64LE(pollId),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    buf.set(p, offset);
    offset += p.length;
  }
  return buf;
}

// ---------- Account data parsing ----------

function decodeLittleEndianU64(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return view.getBigUint64(0, true);
}

interface PollData {
  pollId: bigint;
  description: string;
  pollStart: bigint;
  pollEnd: bigint;
  candidateAmount: bigint;
}

function parsePollAccount(data: Uint8Array): PollData {
  // Skip 8-byte discriminator
  const pollId = decodeLittleEndianU64(data, 8);
  const descLen = new DataView(data.buffer, data.byteOffset + 16, 4).getUint32(0, true);
  const description = new TextDecoder().decode(data.slice(20, 20 + descLen));
  const off = 20 + descLen;
  const pollStart = decodeLittleEndianU64(data, off);
  const pollEnd = decodeLittleEndianU64(data, off + 8);
  const candidateAmount = decodeLittleEndianU64(data, off + 16);
  return { pollId, description, pollStart, pollEnd, candidateAmount };
}

interface CandidateData {
  candidateName: string;
  candidateVotes: bigint;
}

function parseCandidateAccount(data: Uint8Array): CandidateData {
  // Skip 8-byte discriminator
  const nameLen = new DataView(data.buffer, data.byteOffset + 8, 4).getUint32(0, true);
  const candidateName = new TextDecoder().decode(data.slice(12, 12 + nameLen));
  const candidateVotes = decodeLittleEndianU64(data, 12 + nameLen);
  return { candidateName, candidateVotes };
}

// ---------- RPC helpers ----------

const RPC_URL = "https://api.devnet.solana.com";

async function fetchAccountData(address: string): Promise<Uint8Array | null> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [address, { encoding: "base64" }],
    }),
  });
  const json = await res.json();
  if (!json.result?.value?.data) return null;
  const b64 = json.result.value.data[0];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------- Component ----------

type Tab = "create" | "candidates" | "vote";

export function VotingCard() {
  const { wallet, status } = useWalletConnection();
  const { send, isSending } = useSendTransaction();

  const [activeTab, setActiveTab] = useState<Tab>("create");
  const [txStatus, setTxStatus] = useState<string | null>(null);

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

  const walletAddress = wallet?.account.address;

  // --- Create Poll ---
  const handleCreatePoll = useCallback(async () => {
    if (!walletAddress || !pollId || !description) return;
    try {
      setTxStatus("Creating poll...");
      const id = BigInt(pollId);
      const start = pollStart ? BigInt(Math.floor(new Date(pollStart).getTime() / 1000)) : 0n;
      const end = pollEnd ? BigInt(Math.floor(new Date(pollEnd).getTime() / 1000)) : BigInt(Math.floor(Date.now() / 1000) + 86400 * 30);

      const [pollPda] = await getPollPda(id);

      const ix = {
        programAddress: VOTING_PROGRAM_ADDRESS,
        accounts: [
          { address: walletAddress, role: 3 as const },
          { address: pollPda, role: 1 as const },
          { address: SYSTEM_PROGRAM_ADDRESS, role: 0 as const },
        ],
        data: buildInitializePollData(id, description, start, end),
      };

      setTxStatus("Awaiting signature...");
      const sig = await send({ instructions: [ix] });
      setTxStatus(`Poll created! Tx: ${sig?.slice(0, 20)}...`);
      setPollId("");
      setDescription("");
      setPollStart("");
      setPollEnd("");
    } catch (err) {
      console.error(err);
      setTxStatus(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [walletAddress, pollId, description, pollStart, pollEnd, send]);

  // --- Add Candidate ---
  const handleAddCandidate = useCallback(async () => {
    if (!walletAddress || !candPollId || !candidateName) return;
    try {
      setTxStatus("Adding candidate...");
      const id = BigInt(candPollId);
      const [pollPda] = await getPollPda(id);
      const [candPda] = await getCandidatePda(id, candidateName);

      const ix = {
        programAddress: VOTING_PROGRAM_ADDRESS,
        accounts: [
          { address: walletAddress, role: 3 as const },
          { address: pollPda, role: 1 as const },
          { address: candPda, role: 1 as const },
          { address: SYSTEM_PROGRAM_ADDRESS, role: 0 as const },
        ],
        data: buildInitializeCandidateData(candidateName, id),
      };

      setTxStatus("Awaiting signature...");
      const sig = await send({ instructions: [ix] });
      setTxStatus(`Candidate added! Tx: ${sig?.slice(0, 20)}...`);
      setCandidateName("");
    } catch (err) {
      console.error(err);
      setTxStatus(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [walletAddress, candPollId, candidateName, send]);

  // --- Vote ---
  const handleVote = useCallback(async () => {
    if (!walletAddress || !votePollId || !voteCandidateName) return;
    try {
      setTxStatus("Casting vote...");
      const id = BigInt(votePollId);
      const [pollPda] = await getPollPda(id);
      const [candPda] = await getCandidatePda(id, voteCandidateName);

      const ix = {
        programAddress: VOTING_PROGRAM_ADDRESS,
        accounts: [
          { address: walletAddress, role: 0 as const },
          { address: pollPda, role: 0 as const },
          { address: candPda, role: 1 as const },
        ],
        data: buildVoteData(voteCandidateName, id),
      };

      setTxStatus("Awaiting signature...");
      const sig = await send({ instructions: [ix] });
      setTxStatus(`Vote cast! Tx: ${sig?.slice(0, 20)}...`);
    } catch (err) {
      console.error(err);
      setTxStatus(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [walletAddress, votePollId, voteCandidateName, send]);

  // --- Fetch poll info ---
  const handleFetchPoll = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const pollIdBig = BigInt(id);
      const [pollPda] = await getPollPda(pollIdBig);
      const data = await fetchAccountData(pollPda.toString());
      if (!data) {
        setPollData(null);
        setCandidates([]);
        return;
      }
      const parsed = parsePollAccount(data);
      setPollData(parsed);

      // Fetch all known candidates
      const fetchedCandidates: CandidateData[] = [];
      for (const name of candidateNames) {
        const [candPda] = await getCandidatePda(pollIdBig, name);
        const candData = await fetchAccountData(candPda.toString());
        if (candData) {
          fetchedCandidates.push(parseCandidateAccount(candData));
        }
      }
      setCandidates(fetchedCandidates);
    } catch {
      setPollData(null);
      setCandidates([]);
    }
  }, [candidateNames]);

  // Track candidate names for lookup
  const addCandidateNameToList = useCallback((name: string) => {
    setCandidateNames((prev) =>
      prev.includes(name) ? prev : [...prev, name]
    );
  }, []);

  if (status !== "connected") {
    return (
      <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="space-y-1">
          <p className="text-lg font-semibold">Voting Program</p>
          <p className="text-sm text-muted">
            Connect your wallet to create polls, add candidates, and vote.
          </p>
        </div>
        <div className="rounded-lg bg-cream/50 p-4 text-center text-sm text-muted">
          Wallet not connected
        </div>
      </section>
    );
  }

  return (
    <section className="w-full max-w-3xl space-y-5 rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
      <div className="space-y-1">
        <p className="text-lg font-semibold">Voting Program</p>
        <p className="text-sm text-muted">
          Create polls, register candidates, and cast your vote — all on-chain.
        </p>
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
            {tab === "candidates" ? "Add Candidate" : tab === "create" ? "Create Poll" : "Vote"}
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
              <label className="mb-1 block text-xs text-muted">Start (optional)</label>
              <input
                type="datetime-local"
                value={pollStart}
                onChange={(e) => setPollStart(e.target.value)}
                disabled={isSending}
                className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">End (optional)</label>
              <input
                type="datetime-local"
                value={pollEnd}
                onChange={(e) => setPollEnd(e.target.value)}
                disabled={isSending}
                className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground/30 disabled:opacity-60"
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
            onClick={async () => {
              addCandidateNameToList(candidateName);
              await handleAddCandidate();
            }}
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
              disabled={!votePollId}
              className="rounded-lg border border-border-low bg-cream px-4 py-2.5 text-sm font-medium transition hover:opacity-80 disabled:opacity-40 cursor-pointer"
            >
              Lookup
            </button>
          </div>

          {/* Poll info */}
          {pollData && (
            <div className="rounded-xl border border-border-low bg-cream/30 p-4 space-y-2">
              <p className="text-sm font-medium">
                Poll #{pollData.pollId.toString()}: {pollData.description}
              </p>
              <p className="text-xs text-muted">
                Candidates registered: {pollData.candidateAmount.toString()}
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
                        {c.candidateVotes.toString()} vote{c.candidateVotes !== 1n ? "s" : ""}
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
            onClick={async () => {
              addCandidateNameToList(voteCandidateName);
              await handleVote();
            }}
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
