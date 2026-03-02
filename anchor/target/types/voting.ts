/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/voting.json`.
 */
export type Voting = {
  "address": "DHt4nNcMmkc1BGtkxPyPJm656ScJdrcQJzPhsLURTEY3",
  "metadata": {
    "name": "voting",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "A SOL voting program"
  },
  "instructions": [
    {
      "name": "initializeCandidate",
      "docs": [
        "Registers a new candidate under an existing poll.",
        "",
        "The candidate PDA is derived from seeds: [poll_id (LE bytes), candidate_name (bytes)].",
        "This means each candidate name is unique *per poll*.",
        "The poll's `candidate_amount` counter is also incremented.",
        "",
        "# Arguments",
        "* `candidate_name` — The candidate's display name (max 32 chars)",
        "* `_poll_id`       — The poll to register under (prefixed with _ because",
        "it's only used in the account constraints, not here)"
      ],
      "discriminator": [
        210,
        107,
        118,
        204,
        255,
        97,
        112,
        26
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "poll",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "pollId"
              }
            ]
          }
        },
        {
          "name": "candidate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "arg",
                "path": "pollId"
              },
              {
                "kind": "arg",
                "path": "candidateName"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "candidateName",
          "type": "string"
        },
        {
          "name": "pollId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializePoll",
      "docs": [
        "Creates a new poll account.",
        "",
        "The poll PDA is derived from seeds: [\"poll\", poll_id (as LE bytes)].",
        "Because `init` is used, calling this twice with the same poll_id will",
        "fail (the PDA account already exists), preventing duplicates.",
        "",
        "# Arguments",
        "* `poll_id`     — Unique numeric identifier for this poll",
        "* `description` — Human-readable description (max 280 chars, like a tweet)",
        "* `poll_start`  — Unix timestamp when voting opens",
        "* `poll_end`    — Unix timestamp when voting closes"
      ],
      "discriminator": [
        193,
        22,
        99,
        197,
        18,
        33,
        115,
        117
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "poll",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "pollId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "pollId",
          "type": "u64"
        },
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "pollStart",
          "type": "u64"
        },
        {
          "name": "pollEnd",
          "type": "u64"
        }
      ]
    },
    {
      "name": "vote",
      "docs": [
        "Casts one vote for a candidate in a poll.",
        "",
        "Creates a `VoteReceipt` PDA derived from [\"receipt\", poll_id, voter_pubkey].",
        "Because `init` is used for that account, a second vote attempt from the",
        "same wallet on the same poll will fail — the receipt account already exists.",
        "",
        "# Arguments",
        "* `_candidate_name` — Used only in account constraints for PDA derivation",
        "* `_poll_id`        — Used only in account constraints for PDA derivation"
      ],
      "discriminator": [
        227,
        110,
        155,
        23,
        136,
        126,
        172,
        25
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "poll",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "pollId"
              }
            ]
          }
        },
        {
          "name": "candidate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "arg",
                "path": "pollId"
              },
              {
                "kind": "arg",
                "path": "candidateName"
              }
            ]
          }
        },
        {
          "name": "voteReceipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "pollId"
              },
              {
                "kind": "account",
                "path": "signer"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "candidateName",
          "type": "string"
        },
        {
          "name": "pollId",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "candidate",
      "discriminator": [
        86,
        69,
        250,
        96,
        193,
        10,
        222,
        123
      ]
    },
    {
      "name": "poll",
      "discriminator": [
        110,
        234,
        167,
        188,
        231,
        136,
        153,
        111
      ]
    },
    {
      "name": "voteReceipt",
      "discriminator": [
        104,
        20,
        204,
        252,
        45,
        84,
        37,
        195
      ]
    }
  ],
  "types": [
    {
      "name": "candidate",
      "docs": [
        "Stores the state of a single candidate within a poll."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "candidateName",
            "type": "string"
          },
          {
            "name": "candidateVotes",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "poll",
      "docs": [
        "Stores the state of a single poll."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pollId",
            "type": "u64"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "pollStart",
            "type": "u64"
          },
          {
            "name": "pollEnd",
            "type": "u64"
          },
          {
            "name": "candidateAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "voteReceipt",
      "docs": [
        "A zero-data marker account proving that a wallet already voted in a poll.",
        "",
        "It is created (via `init`) inside the `vote` instruction and is derived",
        "from seeds [\"receipt\", poll_id (LE-u64), voter_pubkey].",
        "Attempting to vote a second time will fail because `init` rejects",
        "creation of an account that already exists."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "voter",
            "type": "pubkey"
          },
          {
            "name": "pollId",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
