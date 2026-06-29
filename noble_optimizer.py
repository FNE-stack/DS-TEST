#!/usr/bin/env python3
"""
First-Noble Optimizer — de256-style world (speed 1, non-premium, scavenge ON,
raid capped). Objective: minimum real-world time to build Academy + mint 1 noble
("first noble"), with ZERO wasted resources (no overflow, no useless builds).

Method: discrete-event simulation of one village, minute by minute. We search
over a single decision variable — how much scavenge CARRY (troops) to invest —
because more troops = faster income but cost resources+pop+build-queue time that
delay the noble. The optimizer sweeps troop-investment levels and, for each,
runs a greedy "always build the next thing on the critical path, never overflow"
policy, then reports the fastest feasible plan.

All TW formulas below are the standard speed-1 values (same on de256).
"""
import math
from dataclasses import dataclass, field

# ─── TW BUILDING FORMULAS (speed 1) ──────────────────────────────────────────
# cost(level) = base * factor**(level-1), rounded. pop(level) similar.
# build_time(level) = (base_t * factor_t**(level-1)) / (1 + 0.05)^(hq? ) ... we
# apply the main-building speedup separately. Times in SECONDS at world speed 1.
BLD = {
    # name:      (w_base, s_base, i_base, cost_factor, pop_base, pop_factor, t_base_s, t_factor)
    "main":      (90,  80,  70,  1.26, 5,  1.17, 900,   1.20),
    "barracks":  (200, 170, 90,  1.26, 7,  1.17, 1800,  1.20),
    "stable":    (270, 240, 260, 1.26, 8,  1.17, 6000,  1.20),
    "smith":     (220, 180, 240, 1.26, 20, 1.17, 6000,  1.20),
    "market":    (100, 100, 100, 1.26, 10, 1.17, 2700,  1.20),
    "place":     (10,  40,  30,  1.26, 0,  1.0,  600,   1.20),
    "farm":      (45,  40,  30,  1.17, 0,  1.0,  1200,  1.20),
    "storage":   (60,  50,  40,  1.265,0,  1.0,  1200,  1.20),
    "wood":      (50,  60,  40,  1.25, 5,  1.155,900,   1.20),
    "stone":     (65,  50,  40,  1.27, 5,  1.155,900,   1.20),
    "iron":      (75,  65,  70,  1.252,10, 1.135,1080,  1.20),
    # REWARD-FARM buildings: cheap, FAST, low/no-pop. Their early levels cost
    # LESS than the 150/150/100 first-to-level refund, and build in seconds, so
    # building them is near-free resources (user's insight: Versteck lvl1 =
    # 63/75/63 in 7s → +199 net). hide(Versteck) & wall are 0-pop.
    "hide":      (50,  60,  50,  1.25, 0,  1.0,  7,     1.20),   # Versteck
    "wall":      (50,  100, 50,  1.26, 0,  1.0,  200,   1.20),   # Wall
    "snob":      (15000,25000,10000,2.0,80, 1.0, 36000, 1.20),  # Academy (Adelshof)
}
# Mine production per HOUR by level (speed 1) — same table the bot uses.
MINE_PROD = [5,30,35,41,47,55,64,74,86,100,117,136,158,184,214,249,289,337,
             391,455,530,616,717,833,969,1127,1311,1525,1774,2063,2400]
# Farm population capacity by level (speed 1), levels 0..30.
FARM_POP = [240,281,330,386,453,531,622,729,855,1002,1175,1377,1614,1893,2219,
            2602,3050,3576,4192,4914,5760,6752,7916,9282,10885,12764,14965,
            17544,20567,24109,28261]
# Storage capacity by level (speed 1).
STORE_CAP = [1000,1229,1512,1859,2285,2810,3454,4247,5222,6420,7893,9705,11932,
             14670,18037,22177,27266,33523,41217,50675,62305]

# ─── UNITS ───────────────────────────────────────────────────────────────────
# name: (wood, stone, iron, pop, carry, train_time_s @ barracks/stable lvl1)
UNIT = {
    "spear": (50, 30, 10, 1, 25, 1020),
    "sword": (30, 30, 70, 1, 15, 1500),
    "axe":   (60, 30, 40, 1, 10, 1320),
    "light": (125,100,250,4, 80, 1800),  # LKAV (needs stable + smith5 + research)
}

# ─── SCAVENGE (Raubzug) ──────────────────────────────────────────────────────
SCAV = {  # tier: (loot_factor, unlock_w, unlock_s, unlock_i)
    1: (0.10, 25, 30, 25),
    2: (0.25, 250, 300, 250),
    3: (0.50, 1000, 1200, 1000),
    4: (0.75, 10000, 12000, 10000),
}
DUR_INIT, DUR_FACTOR, DUR_EXP = 1800.0, 0.7722074896557402, 0.45

# Noble: needs market for coins. 1st noble = 1 gold coin.
COIN_COST = (28000, 30000, 25000)   # w,s,i for the first coin (TW standard 1st)


def cost(b, lvl):
    w,s,i,cf,pb,pf,tb,tf = BLD[b]
    f = cf**(lvl-1)
    return (round(w*f), round(s*f), round(i*f),
            round(pb*pf**(lvl-1)) if pf!=1.0 else pb)

def btime(b, lvl, main_lvl):
    *_, tb, tf = BLD[b]
    t = tb * tf**(lvl-1)
    # main building cuts ALL build times: divide by 1.05^(main_lvl)
    return t / (1.05**main_lvl)

def scav_run_seconds(total_carry, loot_factor):
    if total_carry <= 0: return 1e9
    return DUR_INIT + DUR_FACTOR * (total_carry**DUR_EXP) / max(loot_factor,1e-9)
    # NOTE: longer/higher tiers take longer; loot per run = carry*loot_factor.


@dataclass
class V:
    t: float = 0.0          # seconds elapsed
    w: float = 0.0; s: float = 0.0; i: float = 0.0
    lv: dict = field(default_factory=lambda: {b:0 for b in BLD})
    troops: dict = field(default_factory=lambda: {u:0 for u in UNIT})
    pop_used: int = 0
    scav_busy_until: float = 0.0
    have_coin: bool = False
    steps: list = field(default_factory=list)   # ordered (building,level,t) plan

    def store_cap(self):  return STORE_CAP[min(self.lv["storage"], len(STORE_CAP)-1)]
    def pop_cap(self):    return FARM_POP[min(self.lv["farm"], len(FARM_POP)-1)]
    def unlocked_tiers(self):
        # tiers we can afford to have unlocked are tracked separately; see sim
        return self._tiers
    def carry(self):
        return sum(self.troops[u]*UNIT[u][4] for u in UNIT)
    def mine_income_per_s(self):
        ph = sum(MINE_PROD[min(self.lv[m],30)] for m in ("wood","stone","iron"))
        return 0  # computed per-resource below


def mine_rate(v, res):  # resources/sec for one mine type
    lvl = min(v.lv[res], 30)
    return MINE_PROD[lvl] / 3600.0


# ─── PREREQUISITES (TW standard) ─────────────────────────────────────────────
PREREQ = {
    "barracks": {"main":3},
    "stable":   {"main":10,"barracks":5},
    "smith":    {"main":5,"barracks":1},
    "market":   {"main":3},
    "snob":     {"main":20,"smith":20,"market":10},   # Academy gate
    "place":    {}, "farm":{}, "storage":{}, "wood":{}, "stone":{}, "iron":{}, "main":{},
    "hide":     {"main":1},   # Versteck needs main 1
    "wall":     {"main":1},   # Wall needs main 1
}
def prereq_ok(v,b):
    return all(v.lv.get(k,0)>=lv for k,lv in PREREQ[b].items())

def afford(v,c):
    return v.w>=c[0] and v.s>=c[1] and v.i>=c[2] and (v.pop_used+c[3])<=v.pop_cap()

def simulate(spear_target, do_lkav, verbose=False, horizon_days=40):
    """Greedy: each build-slot pick the next building on the NOBLE critical path;
    trickle spears up to spear_target (scavenge carry) but NEVER overflow storage
    or outspend. Returns hours-to-first-noble (or inf)."""
    v=V(); v._tiers=0
    # Starting resource pile every TW village begins with.
    v.w=v.s=v.i=500
    # FIRST-TO-LEVEL rewards: on a young world your first village is first in
    # the world to reach essentially EVERY building level, and each first
    # (building, level) pays 150/150/100 — all the way to max. So in the race to
    # the FIRST noble, EVERY build completion refunds 150/150/100. This is a huge
    # subsidy: many early builds are net resource-POSITIVE (cost < 400 refund),
    # so the optimal plan front-loads lots of cheap levels. (The "only once /
    # nothing at your 2nd village" caveat is irrelevant here — we model village
    # #1 as the frontrunner taking every level-first.)
    QUEST_REWARD = (150,150,100)
    SLOTS=2
    build_end=[0.0]*0
    dt=60.0  # 1-min steps
    horizon=horizon_days*86400
    # scavenge: keep all troops on tier = highest unlocked
    pending=[]  # (finish_t, b, lvl)
    # noble critical path target order (only what speeds the noble + supporting econ)
    def next_build():
        # Returns (b,lvl,cost) for the best next build, or None.
        # Critical path to noble: place1, mines (income), storage/farm (no waste),
        # main->20, smith->20, market->10, barracks(for spears), then snob.
        # Account for builds already in the queue this tick: the effective level
        # of a building = current + number queued, so two slots don't both pick
        # "main->1". (Bug fix: duplicate steps / wasted parallel same-level.)
        queued_lv={}
        for (_ft,_b,_lv) in pending:
            queued_lv[_b]=max(queued_lv.get(_b,0), _lv)
        def eff(b): return max(v.lv[b], queued_lv.get(b,0))
        # Hard per-building max level (some buildings don't level: rally point
        # = lvl 1 only; Academy = 1 for the first noble). Prevents bogus steps
        # like "Versammlungsplatz Stufe 2" which doesn't exist in TW.
        MAXLVL={"place":1,"snob":1,"main":30,"smith":20,"market":25,
                "barracks":25,"stable":20,"wood":30,"stone":30,"iron":30,
                "farm":30,"storage":30,
                # hide/wall: only build while net-profitable (computed below);
                # hard cap so they never climb into loss-making levels.
                "hide":8,"wall":6}
        cands=[]
        for b in BLD:
            lvl=eff(b)+1
            if lvl > MAXLVL.get(b, 30): continue
            if not prereq_ok(v,b): continue
            c=cost(b,lvl)
            cands.append((b,lvl,c))
        # PHASE-GATED policy (mirrors what actually worked on the live bot):
        #   Phase A (income build-up): rush place1 + mines + barracks(spears) +
        #     just-enough storage/farm so scavenge income ramps. The Adelshof
        #     gate (main/smith/market->snob) is LOCKED OUT until income is healthy
        #     — building the gate first starves the economy that pays for it
        #     (the stall we saw: market 9 / no mines / dead).
        #   Phase B (gate): once mine income is "good enough" (mines ~lvl GATE_MINE)
        #     pour everything into main->20, smith->20, market->10, then snob.
        GATE_MINE = 20   # build mines high before the expensive gate (iron-heavy)
        def avg_mine():
            return (v.lv["wood"]+v.lv["stone"]+v.lv["iron"])/3.0
        income_ready = avg_mine() >= GATE_MINE
        # Storage just needs to hold the priciest single purchase on the path:
        # the noble coin (~30k) is the max, so storage ~17 (cap 33523) suffices.
        # Capping prevents the "resources sit at cap because the GATE is stalled
        # → build storage forever" deadlock. Farm capped at the pop the plan
        # actually needs (mines+barracks+spears+snob pop).
        STORAGE_CAP_LVL = 18      # cap 41217 > coin 30k, comfortable buffer
        FARM_CAP_LVL    = 28      # must house mines+barracks+spears+snob(80 pop)
        def need_capacity(b):
            if b=="storage":
                if v.lv["storage"]>=STORAGE_CAP_LVL: return False
                return max(v.w,v.s,v.i) >= 0.80*v.store_cap()
            if b=="farm":
                if v.lv["farm"]>=FARM_CAP_LVL: return False
                return v.pop_used >= 0.85*v.pop_cap()
            return False
        GATE_CAP={"main":20,"smith":20,"market":10}
        BOOT_MINE = 6   # tiny mine base for early income before scavenge kicks in
        def score(item):
            # STRICT PRIORITY LADDER (higher = built first). Designed to bootstrap
            # the income engine BEFORE maxing anything, then fund the gate:
            #   1. capacity if pressured (never waste income)
            #   2. place1 (unlock scavenge)
            #   3. main->3 (unlock barracks) + barracks1 (spears->scavenge carry)
            #   4. a few mines (BOOT_MINE) so we have base income to start
            #   5. mines -> GATE_MINE on scavenge income (ROI-ordered)
            #   6. the gate: main/smith/market -> caps, in parallel
            #   7. snob (Academy)
            b,lvl,c=item
            # 0 REWARD-FARM: cheap+fast+low-pop builds whose cost < the
            # 150/150/100 refund are NET-POSITIVE resources, and (hide/wall)
            # build in seconds with no pop. Grab them at top priority — they
            # PAY for the rest of the plan and barely occupy a slot (7s for
            # Versteck). Only while genuinely net-profitable on all three res.
            if b in ("hide","wall"):
                cw,cs,ci = c[0],c[1],c[2]
                profitable = (cw < QUEST_REWARD[0] and cs < QUEST_REWARD[1] and ci < QUEST_REWARD[2])
                if profitable:
                    net = (QUEST_REWARD[0]-cw)+(QUEST_REWARD[1]-cs)+(QUEST_REWARD[2]-ci)
                    return 9.5e8 + net    # above everything; bigger net first
                return -1                 # past profitability → never build
            # 1 capacity
            if b in ("storage","farm"):
                return 9.0e8 if need_capacity(b) else -1
            # 2 scavenge unlock
            if b=="place":
                return 8.0e8 if v.lv["place"]<1 else -1
            # 3 income bootstrap: main to 3 (barracks prereq), then barracks 1
            if b=="main" and v.lv["main"]<3:
                return 7.8e8
            if b=="barracks":
                bcap = 5 if do_lkav else 1
                return 7.6e8 if v.lv["barracks"]<bcap else -1
            # 4 boot mines (a few levels) so base income exists before scavenge
            if b in ("wood","stone","iron") and v.lv[b]<BOOT_MINE:
                gain=MINE_PROD[min(lvl,30)]-MINE_PROD[min(lvl-1,30)]
                cp=c[0]+c[1]+c[2]*1.4+1
                return 7.4e8 + (gain/cp)*1e4
            if do_lkav and b=="stable":
                return 6.6e8 if v.lv["stable"]<1 else -1
            if do_lkav and b=="smith" and v.lv["smith"]<5:
                return 6.4e8
            # 5 mines up to GATE_MINE (ROI-ordered among the trio)
            if b in ("wood","stone","iron"):
                if v.lv[b] >= GATE_MINE: return -1
                gain=MINE_PROD[min(lvl,30)]-MINE_PROD[min(lvl-1,30)]
                cp=c[0]+c[1]+c[2]*1.4+1
                return 6.0e8 + (gain/cp)*1e5
            # 6 the gate (only once mines maxed = income_ready), parallel climb
            if b in ("main","smith","market"):
                cap=GATE_CAP[b]
                if v.lv[b]>=cap: return -1
                if not income_ready: return -1
                progress = v.lv[b]/cap
                return 7e8 - progress*1e8
            # 7 Academy
            if b=="snob": return 1e9
            return -1
        scored=[(score(it),it) for it in cands]
        scored=[(s,it) for s,it in scored if s>-1]
        if not scored: return None
        return max(scored,key=lambda x:x[0])[1]

    stall_t=0.0  # seconds since the last build STARTED (stall detector)
    while v.t<horizon and not v.have_coin:
        # Early-exit if we've gone a long time with resources pinned at cap and
        # no build progressing — that's a structural stall, not a slow plan, so
        # don't waste the full horizon simulating it.
        if (max(v.w,v.s,v.i) >= 0.999*v.store_cap() and len(pending)==0
                and stall_t > 6*3600):
            break
        # income
        v.w=min(v.store_cap(), v.w+mine_rate(v,"wood")*dt)
        v.s=min(v.store_cap(), v.s+mine_rate(v,"stone")*dt)
        v.i=min(v.store_cap(), v.i+mine_rate(v,"iron")*dt)
        # scavenge income (all troops, highest unlocked tier)
        if v._tiers>0 and v.t>=v.scav_busy_until and v.carry()>0:
            lf=SCAV[v._tiers][0]; C=v.carry()
            loot=C*lf
            v.w=min(v.store_cap(), v.w+loot/3); v.s=min(v.store_cap(),v.s+loot/3); v.i=min(v.store_cap(),v.i+loot/3)
            v.scav_busy_until=v.t+scav_run_seconds(C,lf)
        # finish builds (+ pay the early-game first-build quest reward)
        for (ft,b,lvl) in list(pending):
            if v.t>=ft:
                v.lv[b]=lvl; pending.remove((ft,b,lvl))
                # every first-to-level build refunds 150/150/100 (capped at store)
                v.w=min(v.store_cap(), v.w+QUEST_REWARD[0])
                v.s=min(v.store_cap(), v.s+QUEST_REWARD[1])
                v.i=min(v.store_cap(), v.i+QUEST_REWARD[2])
        # unlock scavenge tiers from surplus (cheap, huge ROI)
        for tier in (1,2,3):
            if v._tiers==tier-1:
                _,uw,us,ui=SCAV[tier]
                if v.w>=uw and v.s>=us and v.i>=ui and v.lv["place"]>=1:
                    v.w-=uw; v.s-=us; v.i-=ui; v._tiers=tier
                    v.steps.append({
                        "b": "scavenge", "lvl": tier, "t": round(v.t),
                        "cost": {"wood": uw, "stone": us, "iron": ui, "pop": 0},
                        "pop_used": v.pop_used, "pop_cap": v.pop_cap(),
                        "store_cap": v.store_cap(), "tiers": v._tiers,
                        "spears": v.troops.get("spear", 0),
                        "res": {"wood": round(v.w), "stone": round(v.s), "iron": round(v.i)},
                    })
        # start builds if slot free (BUILDS get first claim on resources)
        started_build=False
        while len(pending)<SLOTS:
            nb=next_build()
            if nb is None: break
            b,lvl,c=nb
            if not afford(v,c): break
            v.w-=c[0]; v.s-=c[1]; v.i-=c[2]; v.pop_used+=c[3]
            pending.append((v.t+btime(b,lvl,v.lv["main"]), b, lvl))
            # Rich step snapshot: the guide bakes this in (timeline) AND the
            # live-fetch check compares actual state to it ("on track?").
            v.steps.append({
                "b": b, "lvl": lvl, "t": round(v.t),           # what + when (sec)
                "cost": {"wood": c[0], "stone": c[1], "iron": c[2], "pop": c[3]},
                "pop_used": v.pop_used, "pop_cap": v.pop_cap(),  # pop after this
                "store_cap": v.store_cap(),
                "tiers": v._tiers, "spears": v.troops.get("spear", 0),
                # resources expected ON HAND right after starting this build —
                # the check layer compares your real res vs this to spot drift.
                "res": {"wood": round(v.w), "stone": round(v.s), "iron": round(v.i)},
            })
            started_build=True
        stall_t = 0.0 if started_build else stall_t+dt
        # train spears toward target (scavenge carry). Spears drive scavenge
        # income, so we want them EARLY (phase A), but never starve builds: train
        # from surplus above a buffer. Spears are cheap (50/30/10) and iron-light,
        # so they barely compete with the iron-heavy gate. Train aggressively
        # while below target; the buffer protects the build queue.
        if v.lv["barracks"]>=1 and v.troops["spear"]<spear_target:
            cu=UNIT["spear"]
            buf=500  # keep this much of each res so builds keep flowing
            # train as many as surplus allows this tick (barracks throughput is
            # high once leveled; we cap at a few per minute to stay realistic).
            for _ in range(3):
                if v.troops["spear"]>=spear_target: break
                if (v.w>=cu[0]+buf and v.s>=cu[1]+buf and v.i>=cu[2]+buf
                        and v.pop_used+1<=v.pop_cap()):
                    v.w-=cu[0]; v.s-=cu[1]; v.i-=cu[2]; v.pop_used+=1; v.troops["spear"]+=1
                else:
                    break
        # mint coin once market>=1 and Academy (snob) built
        if v.lv["snob"]>=1 and not v.have_coin and v.lv["market"]>=1:
            if v.w>=COIN_COST[0] and v.s>=COIN_COST[1] and v.i>=COIN_COST[2]:
                v.have_coin=True
        v.t+=dt
    return v.t/3600.0 if v.have_coin else float('inf'), v

# ─── SEARCH ──────────────────────────────────────────────────────────────────
def run_search():
    out=open("plan_out.txt","w",encoding="utf-8")
    def P(*a): print(*a,file=out); print(*a)
    P("Sweeping scavenge troop investment (spear target)...\n")
    best=None
    for st in range(50, 700, 50):
        hrs,v=simulate(st, False)
        if hrs<1e8:
            if best is None or hrs<best[0]:
                best=(hrs,st,False,v)
                P(f"  spear_target={st:3d}: {hrs:6.1f}h  ({hrs/24:4.1f}d)  *best*")
            else:
                P(f"  spear_target={st:3d}: {hrs:6.1f}h  ({hrs/24:4.1f}d)")
        else:
            P(f"  spear_target={st:3d}: infeasible (stalled)")
    P("")
    if best:
        hrs,st,lkav,v=best
        P(f"BEST PLAN: spear_target={st} -> first noble in {hrs:.1f}h = {hrs/24:.1f} days\n")
        P("ORDERED STEP PLAN (timestamp · what · pop · expected res on hand):")
        for s in v.steps:
            kind = "SCAV tier" if s["b"]=="scavenge" else "build"
            r=s["res"]
            P(f"  +{s['t']/3600:5.1f}h  {kind:9s} {s['b']:9s} -> {s['lvl']:<2}  "
              f"pop {s['pop_used']}/{s['pop_cap']}  res {r['wood']}/{r['stone']}/{r['iron']}")
        P(f"\n  total steps: {len(v.steps)}")

        # ── emit the rich timeline JSON the guide bakes in ──
        import json
        plan={
            "world":"de256-style (speed1, non-premium, scavenge, raid-capped)",
            "objective":"first noble, zero waste",
            "noble_hours":round(hrs,1),"spear_target":st,
            "level_reward":{"wood":150,"stone":150,"iron":100},
            "steps":[
                {"type":("scav" if s["b"]=="scavenge" else "build"),
                 "building":s["b"],"level":s["lvl"],
                 "at_h":round(s["t"]/3600,2),
                 "cost":s["cost"],
                 "pop_used":s["pop_used"],"pop_cap":s["pop_cap"],
                 "store_cap":s["store_cap"],"tiers":s["tiers"],"spears":s["spears"],
                 "expect_res":s["res"]}
                for s in v.steps]
        }
        open("noble_plan.json","w",encoding="utf-8").write(json.dumps(plan))
        P(f"\n  wrote noble_plan.json ({len(plan['steps'])} steps with full timeline)")
    else:
        P("NO FEASIBLE PLAN — still stalling, debug needed")
    out.close()

if __name__ == "__main__":
    run_search()
