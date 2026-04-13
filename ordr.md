# Ordr.trade

## Introduction

Ordr.trade is building a next generation fully on chain order book exchange on Solana. We have a working limit order book implementation built with Pinocchio (zero alloc, native Rust) and are now evolving the architecture to solve the structural problems that have prevented on chain CLOBs from serving market makers effectively.

Our goal is simple: bring institutional grade market microstructure to Solana by eliminating the adverse selection, write lock contention, and latency arbitrage that force market makers to quote wide spreads on chain today. The result will be tighter spreads, deeper books, and better execution for every trader on the network.

## The Problem

Every on chain order book built on Solana so far shares a fundamental design flaw: a single, shared order book account where all makers and takers compete for write access. This creates three compounding problems.

**Write lock contention :** Solana allows only one transaction to write to an account per slot. When every maker reprice, every new order, and every fill hits the same account, participants fight for inclusion. During volatile moments , exactly when makers need to update quotes most  this contention spikes, forcing makers to pay higher priority fees just to manage their own positions.

**Expensive quote updates :** Repricing on a traditional CLOB means cancelling existing orders and placing new ones. Each operation is a lookup, removal, and sorted insertion that consumes compute units. A market maker quoting multiple levels on both sides can exhaust a significant portion of their compute budget on a single reprice cycle. Across dozens of markets and hundreds of updates per second, compute becomes a bottle neck.

**Latency arbitrage and toxic flow(Toxic MEV) :**  When external prices move, there is a window where on chain quotes are stale. Arbitrageurs exploit this gap by submitting transactions with high priority fees to trade against stale liquidity before makers can update. Makers price this adverse selection risk into their spreads ; a fair value spread of 0.5 basis points may widen to 3–5 basis points. On meaningful volume, the difference is huge and is ultimately paid by every trader on every transaction.

These problems are not implementation bugs. They are structural consequences of the shared account CLOB design.

## Our Approach

Ordr.trade addresses each of these problems through three architectural changes to our existing order book engine.

### Private Maker Books

Instead of a single shared order book, every market maker on Ordr.trade will own their own on chain order book account which is a separate account that only they write to.

When a maker reprices, they write to their own account with zero contention from other participants. Their ability to manage quotes is completely independent of market activity. This eliminates priority fee wars between makers and removes the single account bottleneck entirely.

When a taker submits an order, Ordr.trade aggregates liquidity across all active maker books at execution time, creating a unified view of the best available prices and depth.

### Parametric Pricing

Rather than storing absolute prices for each order level, makers store their orders as offsets from a mid price. A maker's book might express: "I'm quoting 2 ticks wide on the bid, 3 ticks on the ask, with these quantities at each level."

When the market moves, the maker updates a single reference mid price. The entire book shifts in one operation in O(1) regardless of how many levels are quoted. What previously required a dozen cancel and replace operations now costs one price update, reducing compute overhead and enabling makers to react to market moves faster.

### Configurable Market Microstructure with Application Controlled Execution (ACE)

The Solana ecosystem's Internet Capital Markets roadmap identifies ACE —giving smart contracts millisecond level control over their own transaction ordering — as the single most important infrastructure primitive for on chain markets. Ordr.trade builds on this vision by implementing ACE not as a single mechanism, but as a configurable execution layer where each market can compose its own microstructure from a toolkit of ACE primitives.

This is a deliberate design choice. The ICM roadmap itself argues that the only way to discover the best market structure is to test them in production. Rather than hardcoding one execution model, Ordr.trade gives market creators the ability to configure their own rules from the following ACE building blocks:

**Asynchronous Execution:**  Markets can enable a configurable slot based delay on taker orders. When enabled, taker orders are recorded on chain at submission time but execution is deferred by a configurable number of slots . A permissionless crank transaction then executes the order against makers' live prices at execution time not the stale price the taker originally saw. This eliminates the economic edge of latency arbitrage: if an arbitrageur knows their order fills at whatever price the maker is quoting a fixed delay later, the expected value of the trade collapses. 

**Cancel Prioritization:** Markets can enforce that maker cancel and reprice instructions always execute before taker fills within the same block. This gives makers a structural guarantee that they can pull stale quotes before they are traded against, without needing to outbid takers on priority fees. 

**Pro Rata Execution:** At the same price level, fills are distributed proportionally based on each maker's quoted size  not based on arrival time. This incentivizes makers to compete on depth rather than speed, leading to deeper books and more reliable execution for takers.

**Continuous Mode.** Not every market benefits from async execution. Ordr.trade will support fully synchronous continuous markets where trades match instantly with standard fill or kill , settling atomically in a single transaction. This preserves composability for protocols that need it like liquidation engines, cross protocol arbitrage, and any integration that requires atomic settlement. Continuous markets still benefit from  Private Maker Books and parametric pricing.

By composing these primitives per market, Ordr.trade becomes an ACE powered exchange platform rather than a single design order book. A SOL/USDC spot market might run with async execution and pro rata matching to attract deep institutional liquidity. A new token launch market might use continuous mode to preserve composability with Jupiter routing. The market creator chooses the microstructure; the protocol enforces it deterministically on chain.

This aligns directly with the ICM roadmap's vision of Solana as a flexible foundation for market microstructure experimentation, and positions Ordr.trade to integrate with Jito BAM's plugin framework as that infrastructure matures.

## Current State

We have a fully implemented on-chain order book program built with Pinocchio in native Rust (no Anchor, no heap allocations). The current codebase includes:

- **Market creation** — PDA based market accounts with configurable tick size and lot size, associated bid/ask orderbook accounts, and base/quote token vaults.
- **Order placement** — Sorted insertion into fixed-size orderbook arrays (256 slots per side), with token locking into market vaults on placement. Bids lock `price × size` quote tokens; asks lock `size` base tokens.
- **Order cancellation** — Ownership verified removal with proportional refund of unfilled tokens via PDA signed CPI transfers.
- **Order matching** — Permissionless crank based matching of best bid against best ask, settling at the ask price.
- **Market closure** — Authority gated shutdown with empty orderbook enforcement and full rent reclamation.

All state is zero-copy (`#[repr(C)]` structs cast directly from account data), the program uses no allocator, and all account validations (PDA re-derivation, signer checks, vault verification) are in place. This implementation serves as the proven foundation we are evolving toward the sovereign maker book architecture.

## Roadmap

**Total timeline: 12 weeks**

### Phase 1 —  Private Maker Books & Parametric Pricing (Weeks 1–4)

- Refactor state layout from single bid/ask accounts to per maker book accounts with PDA derivation per maker per market.
- Implement parametric pricing: mid price reference storage, offset based order representation, and O(1) reprice instruction.
- Implement pro rata fill distribution at same price levels.
- Unit and integration test

### Phase 2 — Configurable ACE Execution Layer (Weeks 5–8)

- Design and implement the market configuration system: per market flags for async mode, cancel prioritization, and execution model (pro-rata vs. price-time).
- Build taker order queue accounts with slot based delay tracking for async markets.
- Implement cancel prioritization logic: maker cancel/reprice instructions execute before taker fills within the same block.
- Build the permissionless execution crank instruction that fills delayed taker orders against makers' live prices.
- Add execution incentive mechanism for crank operators (on chain fee share per fill).
- Implement continuous mode with atomic fill or kill matching for composable markets.
- Complete Front end implementation with state of the art UI/UX.

### Phase 3 — Testing, Audit Prep & Mainnet Deployment (Weeks 9–12)

- End to end integration testing across all instruction paths.
- Fuzz testing for state corruption, overflow, and edge cases.
- Security hardening: review all unsafe blocks, CPI validations, and PDA derivations.
- Main net deployement
- Documentation of program architecture, instruction formats, and integration guide.
- Preparation of audit ready codebase.

## Team

We are a team of 4 developers with deep experience in Solana program development, systems programming in Rust, and on chain security.

Arjun - https://x.com/4rjunc                              https://github.com/aarjn
Avhi - https://x.com/avhidotsol                    https://github.com/AvhiMaz
Manu - https://x.com/boomheadvt    
Vinaya - https://x.com/Vinayapr23.          https://github.com/Vinayapr23

## Why Solana

Solana is the only chain where a fully on chain order book is even feasible. High throughput, sub-second slot times, low transaction costs, and parallel transaction execution make it the natural home for this architecture. The sovereign maker book design specifically leverages Solana's account model  because each maker writes to their own account, maker reprices can execute in parallel across the entire network without contention.

Ordr.trade is built to align with the Internet Capital Markets roadmap co authored by Anza, Jito Labs, DoubleZero, Drift, and Multicoin Capital. The roadmap identifies ACE as the critical primitive for on-chain market microstructure and calls for flexible infrastructure that lets applications experiment with different execution models in production. Ordr.trade delivers exactly this a configurable ACE powered exchange where each market can compose its own microstructure. As Jito BAM, Alpenglow, and Multiple Concurrent Leaders roll out over the coming months, Ordr.trade's architecture is positioned to integrate with each upgrade and benefit from stronger execution guarantees at the protocol level.

Ordr.trade is not replacing Solana's execution model. It is removing the adverse selection premium from its spreads.

## Conclusion

Ordr.trade has a working on chain order book and a clear architectural path toward eliminating the structural problems that hold back on chain market making.  Private Maker Books remove contention. Parametric pricing makes repricing instant and cheap. A configurable ACE execution layer  combining async execution, cancel prioritization, pro rata matching, and continuous mode lets market creators choose the microstructure that best serves their trading pair, all enforced deterministically on chain.

The result is an exchange platform where market makers can operate efficiently, spreads compress toward fair value, and every trader on Solana gets better execution. Ordr.trade directly advances the Internet Capital Markets roadmap by bringing ACE powered market microstructure experimentation to production on Solana.
