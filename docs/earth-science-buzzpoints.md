# Earth & Space Science: Buzzpoint Analysis

Where a strong player should buzz on the Earth & Space questions in this repo's question bank. The guide is built from what the bank actually asks and how the questions are worded.

Every number below was computed from `data/questions.json` (subject key `ess`). Question counts are **after de-duplication**: records whose first 120 alphanumeric characters match are counted once.

---

## 1. TL;DR: the ten rules

1. **ESS tossups are short.** The median tossup is **18 words** and 82% of short-answer tossups are a single sentence. There is no pyramid to climb. A buzzpoint is a **word**, not a sentence.
2. **Buzz on the anchor *plus* the ask, never the anchor alone.** An anchor is a proper noun or signature phrase such as *Kirkwood gaps*, *S0*, *Einstein ring* or *K–Pg boundary*. It tells you the topic. The ask (*"what element"*, *"what type of"*, *"with which body"*) tells you which fact about that topic is wanted. For example, "Type I supernova" questions are answered *Chandrasekhar limit*, *hydrogen*, *silicon* or *white dwarf* depending on the ask (§5).
3. **About 62% of short-answer tossups put the ask first** (*"What is the term for …"*). The buzz comes at the **first word that makes the definition unique**, often the second content noun in the definition.
4. **About 38% lead with a clue clause and ask at the end** (*"Forsterite and fayalite are endmembers of what …"*). A pro knows the answer at the anchor and **buzzes as the ask noun lands**, not at the question mark.
5. **Don't try to beat the list questions.** *Identify all*, rank and order questions are **14% of tossups**, and you must hear every item. Win them with fast evaluation: decide each statement as it is read.
6. **Multiple-choice tossups are half the ESS tossups (50%).** The correct letter is spread almost evenly (W 24%, X 27%, Y 26%, Z 23%). Buzzing the moment you hear the right choice saves about **1.5 choices** of read time on average.
7. **On NOT / EXCEPT / LEAST questions (14% of MC tossups), check every choice before buzzing.** These questions are built so that one choice sounds wrong but isn't.
8. **The interrupt penalty sets the threshold.** Against an evenly matched opponent, interrupt at **≥55% confidence**. Against one who will beat you to the end of the question, interrupt at **≥40%**. Against a team that can't get it, **don't interrupt at all** (§3).
9. **Learn the collision pairs** (§6): olivine/quartz (no cleavage), CNO/pp chain, Hayashi/Henyey, pycnocline/thermocline/halocline, lenticular galaxy/cloud, chromatic/spherical aberration, and the four unconformities. They cause most wrong early buzzes.
10. **Questions get recycled.** 599 ESS question texts appear more than once (743 duplicate records), so drilling the bank has real payoff.

---

## 2. What the bank looks like

| | Count |
|---|---|
| ESS records | 11,629 |
| Unique ESS questions | 10,886 |
| Unique ESS tossups | 5,544 (2,779 SA / 2,765 MC) |

**Tossup structure** (unique tossups, classified by wording):

| Kind | Share | Median length | Can you buzz early? |
|---|---|---|---|
| MC, positive stem (*"Which of the following is…"*) | 42.8% | 16 words | Yes, on the correct choice |
| SA, single term / name | 34.2% | 19 words | **Yes; this is where buzzpoints matter most** |
| *Identify all* (statements) | 7.4% | 27 words | No |
| MC, negative stem (NOT / EXCEPT / LEAST) | 6.8% | 14 words | Rarely |
| Rank / order | 6.3% | 21 words | No |
| SA, calculation | 2.4% | 24 words | Only once the last number is read |

**Topic mix** (all unique ESS questions, using a keyword classifier. It's approximate: about 14% of questions didn't match any keywords):

| Area | Questions | Share |
|---|---|---|
| Astronomy & space | 4,160 | 38% |
| Geology (minerals, rocks, structure, surface processes, time scale) | 3,247 | 30% |
| Meteorology & climate | 1,123 | 10% |
| Oceanography | 829 | 8% |
| Unclassified | 1,527 | 14% |

Astronomy is the largest area. It's also where anchors are most reliable, because proper nouns (objects, missions, named effects) dominate.

**Largest sources of unique ESS tossups:** NSB Regionals sample sets (1,073), Earth & Space Scrimmage 2025 (219) and 2024 (174), CSUB (173), CSBL (94), SBL (93), FE!M 2025 (82), NESB (82). The NSB sample sets set the style that invitational writers imitate.

---

## 3. When to interrupt: the penalty math

Science Bowl rules: a correct tossup is worth 4 points and earns a 10-point bonus. A wrong answer given **before the question is finished** gives the opponent 4 penalty points, and they then hear the whole question.

Let:
- `p` = your confidence right now,
- `V` = the value of winning the tossup = 4 + 10 × (your bonus conversion). With 60% bonus conversion, `V ≈ 10`.
- `q` = the chance the opponent converts after your neg (assumed 0.8),
- `r` = the chance you win the tossup if you wait for the end.

An interrupt beats waiting when `p·V − (1−p)(4 + q·V) > (2r − 1)·V`. With `V = 10` and `q = 0.8`, that gives:

| If you wait, you win it… | Interrupt when confidence ≥ |
|---|---|
| 20% of the time (opponent is faster and knows it) | **27%** |
| 35% | **41%** |
| 50% (evenly matched) | **55%** |
| 70% | **73%** |
| 90% (weak opponent) | **91%**, which in practice means don't interrupt |

What this means in practice:
- Against strong teams, *knowing* an anchor → answer mapping is worth buzzing on well before the question ends. Hesitating costs more than the occasional neg.
- Against weaker teams, wait for the ask to finish. The anchor tells you the topic but not what the question wants (see Type I supernovae in §5).
- The table assumes you are otherwise fully confident. "Confidence" means *confidence in the exact answer to the ask*, not confidence about the topic.

---

## 4. How ESS tossups are built, and where the buzz lives

### Template A: ask first, definition after (about 62% of SA term tossups)

> *What is the term for the region of seawater where **density** increases drastically with depth?*

In the median SA term tossup, the last interrogative word falls **22% of the way in**. What follows is a definition. The buzzpoint is the **discriminating noun** inside that definition. It's rarely the first content word, because the first content word usually just names a family of answers.

| Question | False buzz (names the family) | Real buzz (makes it unique) | Answer |
|---|---|---|---|
| …region of seawater where **density** increases… | "region of seawater" (pycnocline, thermocline, halocline, photic zone…) | **density** | Pycnocline |
| …type of front occurs when a cold front **overtakes** a warm front | "cold front" | **overtakes** | Occluded front |
| …when precipitation **evaporates before** hitting the ground | "precipitation" | **evaporates before** | Virga |
| …when a meander in a river is **cut off** from the main channel | "meander" | **cut off** | Oxbow lake |
| …orbits in the asteroid belt that are **free of asteroids** | "asteroid belt" | **free of / few asteroids** | Kirkwood gaps |
| …force holds up **white dwarfs** from collapse | "force holds up" | **white dwarfs** | Electron degeneracy pressure |

### Template B: clue first, ask at the end (about 38%)

> *Forsterite and fayalite are the endmembers for the solid solution of what group of minerals?*

The anchor comes first, at a median of 13–42% of the way into the question for strong anchors (§5 table). A pro has the answer ready at the anchor, **waits for the ask noun ("what group of minerals")**, and buzzes on it. Buzzing before the ask costs you here: among short-answer questions that mention forsterite/fayalite, the answer is *iron and magnesium* (the substituting cations) **2 times** and *olivine* only **1 time**.

### Template C: scenario lead-in (common in invitational sets)

> *Anshul is traveling to an area in Slovenia known as the Karst plateau. If he were to dig into the ground, which rock…*

The name and the story are padding. Skip them and buzz on the **first technical noun** (*Karst plateau*). The ask is almost always "which rock / what feature / what term".

### Multiple choice

- **Positive stem:** Form your answer from the stem before the choices start. Buzz the instant it is read, but only if the stem rules out look-alikes. For example, "no cleavage" can be olivine **or** quartz (§6), so wait for the choices to see which one is there.
- **"Best describes" / "most likely":** Hear all four. These questions are written so that two choices are defensible.
- **Negative stem:** Buzz only when you hear the false statement **and** have already confirmed the choices before it. If the false statement is choice W, you still need to hear X–Z unless the fact is ironclad.

---

## 5. The most commonly asked answers, and where to buzz

Counts are unique questions (tossup and bonus, SA and MC) whose answer normalizes to the entry.

### 5.1 Anchor reliability, measured

For each anchor phrase, the table gives:
- **Precision:** how often a single-answer, short-answer question containing the anchor had the expected answer family.
- **Anchor position:** the median point in the question where the anchor appears.

A precise anchor that appears early is a real early buzz. A low-precision anchor is a topic flag only, so wait for the ask.

| Anchor heard | Qs | Precision | Anchor at | Answer family | Verdict |
|---|---|---|---|---|---|
| *Kirkwood gaps* | 6 | 100% | 13% | Jupiter | Early buzz on "which body/planet" |
| *S0* | 5 | 100% | 61% | Lenticular | Buzz on "S0" |
| *long-period comets* | 5 | 100% | 31% | Oort cloud | Buzz on "long-period" |
| *Einstein ring* | 5 | 100% | 42% | Gravitational lensing | Buzz on "Einstein ring" |
| *K–Pg / K–T boundary* | 6 | 100% | 26% | Iridium (3/6) | Topic is locked. Wait for "what element" (other asks: *asteroid impact*, *Cretaceous*) |
| *unconformity* | 12 | 100% | 28% | Some unconformity type | Topic is locked. Buzz on the **rock types** (§6) |
| *cold front overtakes warm* | 5 | 100% | 77% | Occluded front | Buzz on "overtakes" |
| *doldrums / trade winds converge* | 3 | 100% | 54% | ITCZ | Buzz on "converge" |
| *windrows / counter-rotating vortices* | 4 | 100% | 81% | Langmuir circulation | Buzz on "vortices" / "windrows" |
| *Cepheid* | 8 | 88% | 65% | Kappa mechanism / instability strip / P-L relation | Wait for the ask: "what mechanism" / "what region" / "what relation" |
| *triple-alpha* | 10 | 90% | 37% | C-12 / Be-8 / helium flash | Wait for the ask |
| *refracting telescope(s)* | 12 | 83% | 21% | Chromatic aberration | Buzz on "**colors / wavelengths**", **not** on "refracting" (2/12 were spherical aberration) |
| *Crab Nebula* | 6 | 83% | 29% | Pulsar / synchrotron / SN 1054 | Wait for "what object" vs "what radiation" vs "what year" |
| *karst / sinkhole* | 13 | 77% | 18% | Limestone / karst / carbonic acid | Wait for "rock" vs "topography" vs "acid" |
| *21-cm / spin-flip* | 8 | 75% | 14% | Hydrogen | Early buzz on "what element" |
| *Type I / Ia supernova* | 27 | 74% | 47% | Chandrasekhar / H / Si / WD | **Never buzz on the anchor.** Buzz on the verb: *lacks* → hydrogen; *distinguished by the presence of / 635 nm* → silicon; *limit* → Chandrasekhar |
| *meander* | 12 | 67% | 32% | Oxbow lake | Trap: "meanders of the jet stream" → Rossby wave (2/12) |
| *Bowen's reaction series* | 11 | 55% | 33% | Olivine (first) / quartz (last) | Wait for **first/last/which melts first** |
| *RR Lyrae / W Virginis* | 7 | 43% | 15% | Instability strip | Topic flag only |
| *Hayashi / T Tauri* | 7 | 29% | 64% | Henyey track is the *answer* 2/7 times | Collision pair (§6) |
| *E ring* | 12 | 25% | 24% | Enceladus | Topic flag only. Buzz on "**what moon** creates/supplies" |
| *agate / chalcedony / citrine* | 7 | 29% | 48% | Quartz | Low precision: amethyst was the answer 3 times. Wait for the ask |
| *ozone layer* | 5 | 20% | 100% | Stratosphere | Low precision: Dobson unit / aerosol injection. Wait for "what layer" |

### 5.2 Astronomy & space

| Answer (unique Qs) | Buzz on | Don't buzz on / trap |
|---|---|---|
| **Venus** (27) | *slower rotation than revolution*; *retrograde rotation* + "Uranus and what other"; *highest albedo planet*; *most volcanoes*; *runaway greenhouse*; *smallest eccentricity* | "Cannot be at opposition" → Mercury **and** Venus. "Least / most eccentric" → Venus / Mercury, so the adjective decides |
| **White dwarf** (23) | *Ring Nebula central star*; *novae … buildup on*; *carbon deflagration precedes Ia*; "Chandrasekhar limit is the upper mass of what" | If the ask is "what **limit**" → Chandrasekhar. "What **pressure/force**" → electron degeneracy pressure. Buzz on the ask noun |
| **Hydrogen** (21) | *21-cm*, *spin-flip*, *Gunn–Peterson trough*, *metallic … Jupiter's magnetic field*, *Type I lacks* | *Eddington valve / Mira* → hydrogen, but *double ionization / instability strip* → **helium** |
| **Jupiter** (21) | *Kirkwood gaps*; *barycenter outside the Sun*; *metallic hydrogen core*; *Trojan asteroids* | "All gas giants except what planet migrated outward" → Jupiter (it moved inward). Listen for "except" |
| **Mercury** (21) | *3:2 spin–orbit*; *Caloris*; *highest eccentricity*; *largest core fraction*; *within 28° of the Sun*; *transit timed for GR* | *Cinnabar* → the **element** mercury |
| **Neptune** (17) | *Great Dark Spot*, *Scooter*; *does not fit Titius–Bode*; *longest year*; *Voyager 2 … 1989* | Hill-sphere and albedo-comparison MC: wait for the choices |
| **Mars** (17) | *Tharsis*, *Olympus Mons*, *Valles Marineris*, *Elysium*; *hemispheric dichotomy*; *most moons of the terrestrials* | *Tharsis* SA questions were only 60% "Mars" (one answered *Vesta*, another was a matching question). *Ice caps / limnic eruption* → CO₂ |
| **Pulsar** (14) | *lighthouse model*; *glitch*; *first exoplanets (1992)*; *Crab central object*; *plerion* | *Soft gamma repeater / starquake / strongest magnetic field* → **magnetar** (9) |
| **Elliptical** (13) | *IC 1101*; *M87*; *Milky Way–Andromeda merger product*; *Faber–Jackson* | "Lens-shaped" / *S0* → **lenticular** (10) |
| **Chandrasekhar limit** (12) | *maximum mass of a white dwarf*; *~1.4 (1.44) M☉* | *Iron core collapse at …* MC is the same limit applied to the core; check the choices |
| **Enceladus** (12) | *highest albedo in the solar system*; *south-polar plumes (Cassini)*; *supplies the E ring*; *hydrothermal activity* | E-ring questions only name Enceladus 25% of the time |
| **Methane** (12 astro + 8 climate) | *blue of Uranus/Neptune (absorbs red)*; *Titan **lakes/clouds***; *second anthropogenic GHG*; *gas hydrates*; *permafrost* | *Titan **atmosphere*** → **nitrogen**. *Pluto glaciers / Sputnik Planitia* → **nitrogen** |
| **Uranus** (12) | *first planet discovered by telescope / Herschel*; *rotates on its side*; *least internal heat*; *mag. +5.8* | "Retrograde rotation" alone is ambiguous with Venus. Wait for "jovian" |
| **Chromatic aberration** (11) | *different colors/wavelengths focus at different points* | "Refracting" alone is not enough. *Edges of lens/mirror*, *Hubble's mirror* → **spherical** aberration |
| **Brown dwarf** (11) | *deuterium but not hydrogen fusion*; *lithium test*; *< 0.075–0.08 M☉*; *substellar* | *Lithium* in a geology question → spodumene / brine mining |
| **CNO cycle** (10) vs **pp chain** (9) | The **mass number**: *> 1.3 M☉* → CNO; *the Sun / ≤ 1 M☉* → pp | Buzz after the number, not on "hydrogen to helium" |
| **Instability strip** (10) / **kappa mechanism** (§6) | *RR Lyrae, Cepheid, W Virginis all lie in what region* → strip; *opacity-driven pulsation* → kappa | |
| **Kirkwood gap** (10) | *free of / few asteroids* + *resonance with Jupiter* | If Jupiter is in the ask ("with which body"), the answer is Jupiter |
| **Oort cloud** (10) vs **Kuiper belt** (4) | *long-period* → Oort; *short-period / beyond Neptune / Pluto belongs to / disc-shaped* → Kuiper | Buzz on *long* vs *short*, the fourth word of most versions |
| **Zeeman effect** (10) | *splitting of spectral lines* **+ magnetic field / sunspots** | Electric-field splitting → Stark. Hear "magnetic" first |
| **Solar wind** (12) | *aurora + stream of charged particles*; *comet ion/gas tail*; *Van Allen belts fed by* | |
| **Corona** (9) vs **photosphere** (8) | *outermost / visible in eclipse / halo* → corona; *granules / sunspots / limb darkening / blocked in eclipse* → photosphere | |
| **Hayashi track** (9) vs **Henyey track** (4) | *nearly vertical / fully convective / falling luminosity at ~constant T* → Hayashi; *horizontal / radiative / after the Hayashi track / > 0.5 M☉* → Henyey | "Pre-main-sequence track" alone is a 50/50 |
| **Hubble's law** (9) | *recessional velocity proportional to distance* | |
| **Eddington limit** (8) | *maximum luminosity* + *hydrostatic equilibrium / radiation pressure* | |
| **Helium flash** (8) | *onset of triple-alpha in a degenerate core*; *end of the Sun's first red-giant phase* | |
| **Hot Jupiter** (8) | *51 Pegasi b*; *easiest by radial velocity*; *< 0.1 AU gas giant* | |
| **Gravitational lensing** (9) | *Einstein ring*; *Earendel* | |
| **Iron** (17) | *type II core just before collapse*; *kamacite/taenite (iron meteorites)*; *hematite & magnetite*; *metallicity ratio* | |
| **Silicon** (8) | *Ia vs other type I spectra / 635 nm*; *last fuel before iron* | |

### 5.3 Geology

| Answer (unique Qs) | Buzz on | Don't buzz on / trap |
|---|---|---|
| **Basalt** (27) | *Hawaii composed of*; *oceanic plates*; *mid-ocean ridge*; *black sands*; *lunar maria*; *mafic + extrusive* | "Mafic" alone could be **gabbro** (9), which is the **intrusive / coarse** equivalent. Buzz on the texture word |
| **Olivine** (23) | *forsterite / fayalite* (with "what mineral"); *first in Bowen's*; *410/660-km transition*; *nesosilicate*; *mantle xenoliths*; *lower ophiolite* | "No cleavage" → olivine **or** quartz (§6) |
| **Limestone** (22) | *karst / sinkholes / disappearing streams*; *fizzes in HCl*; *most abundant chemical sedimentary rock*; *made mostly of calcite* | If the ask is "**mineral**" → **calcite** (10). The rock/mineral word decides |
| **Quartz** (15) | *Mohs 7*; *agate / chalcedony / jasper (cryptocrystalline)*; *citrine*; *last in Bowen's*; *most resistant to weathering*; *framework silicate*; *syenite lacks* | Amethyst is often the answer to *gem* questions, so check whether the ask is "mineral" or "variety" |
| **Dike** (13) vs **sill** / **laccolith** (5) | *cuts across / discordant / vertical crack* → dike; *horizontal / concordant / parallel* → sill; *domed / arched overlying beds / mushroom* → laccolith | The discordant/concordant word usually comes after "tabular intrusion", so wait for it |
| **Gypsum** (12) | *anhydrite + water*; *evaporite*; *no CO₂ with HCl*; *bottom of the Mediterranean* | |
| **Oxbow lake** (11) | *meander … cut off / pinches off* | Atmospheric meanders → Rossby waves |
| **Calcite** (10) | *Iceland spar*; *travertine/chalk*; *rhombohedral cleavage*; *anhydrite + hydrocarbons → H₂S +* | |
| **Nonconformity** (10), **disconformity** (6), **angular** | Wait for the **lower unit**: igneous/metamorphic below sedimentary → nonconformity; parallel sedimentary with an erosion surface → disconformity; tilted/folded below → angular | "Unconformity" is always there, and the lower unit is what decides |
| **Shale** (10) | *fissile*; *finest-grained sedimentary*; *aquitard* | |
| **Gabbro** (9) | *intrusive equivalent of basalt*; *coarse-grained mafic*; *centre of a batholith (MC)* | |
| **Convergent** (9) | *trenches*, *Andes*, *Indian–Eurasian*, *subduction zone margin* | |
| **Contact metamorphism** (8) | *hornfels*; *ring around batholith*; *no differential pressure* | |
| **Drumlin** (8) | *streamlined asymmetric hills*; *glacier over existing moraine* | Direction questions: the **steep (stoss) end faces where the ice came from**. Wait for the full geometry |
| **Caldera** (8) | *Mazama / Crater Lake*; *summit collapses into emptied magma chamber* | "Crater Lake" is sometimes the answer itself. Wait for "what feature" |
| **Trellis** (8) | *alternating weak and resistant*; *folded*; *parallel ridges* | Dendritic = uniform rock; radial = volcano; rectangular = joints |
| **Normal fault** (8) | *horsts and grabens*; *tension* | |
| **Galena** (7) | *lead ore*; *sulfide*; *silver impurity*; *with sphalerite* | |
| **Shield volcano** (7) vs **stratovolcano** (6) | *Mauna Loa / Hawaii / gentle slopes / Venus* → shield; *steepest / Fuji / Vesuvius / Ring of Fire / largest pyroclastic flows* → strato | |
| **Mesozoic** (7) | *Jurassic belongs to*; *Pangaea breaks up*; *dinosaurs dominate* | Period vs era: *age of fishes / first trees* → **Devonian** |
| **Exfoliation** (6) | *Half Dome*, *peels like an onion*, *pressure release* | Yosemite + "what body" → batholith |
| **Iridium** (9) | *K–Pg boundary* + *what element* | |
| **Peridotite** (10 records) | *mantle rock*; *olivine-rich ultramafic* | |

### 5.4 Meteorology & climate

| Answer (unique Qs) | Buzz on | Don't buzz on / trap |
|---|---|---|
| **Stratosphere** (13) | *ozone layer resides*; *nacreous / polar stratospheric clouds*; *Brewer–Dobson*; *temperature rises with height*; *nuclear-winter aerosols linger* | *Ozone layer* questions are only 20% "what layer" |
| **Troposphere** (11) | *weather / convection / lightning*; *layer we stand in*; *snow-capped peaks (lapse rate)* | |
| **Tropopause** (8) | *anvil tops flatten*; *boundary / inversion* | |
| **Mesosphere** (7) | *meteors burn up*; *coldest*; *too high for balloons, too low for satellites*; *red sprites* | |
| **Thermosphere** (6) | *aurorae*; *X-/gamma-ray absorption*; *least homogeneous* | |
| **Occluded front** (8) | *overtakes*; *purple line with triangles and semicircles on the same side* | Stationary: alternating sides |
| **Katabatic wind** (7) | *downslope drainage*; *cold dense air off a plateau*; *polynyas* | Chinook/foehn questions are usually list questions |
| **ITCZ** (7) | *trade winds converge*; *doldrums* | |
| **Virga** (6) | *evaporates before reaching the ground* | |
| **Mammatus** (5) | *pouches under the anvil*; *formed by sinking air* | |
| **Dunes:** barchan (5), transverse (5), longitudinal (5), parabolic (4) | *crescent, horns downwind, limited sand* → barchan; *abundant sand, steady wind, no vegetation* → transverse; *parallel to the wind* → longitudinal/seif; *vegetation / coastal / horns upwind* → parabolic | "Parabolic" also answers X-ray **mirror** and escape-velocity **orbit** questions. Hear the noun ("dune") first |
| **Water vapor** (5) | *most abundant GHG*; *~97% of natural greenhouse warming*; *principal volcanic gas* | |

### 5.5 Oceanography

| Answer (unique Qs) | Buzz on | Don't buzz on / trap |
|---|---|---|
| **Pycnocline** (9) / **thermocline** (5) / **halocline** | The **property**: *density* / *temperature* / *salinity* | Everything before the property word is shared. Buzz on the property |
| **Amphidromic point** (6) | *zero tidal range / amplitude*; *tides rotate around* | |
| **Neap tide** (5) | *right angles / first or third quarter / partially cancel* | Spring = *aligned / new & full / syzygy* |
| **Benguela current** (5) | *cold, off south-west Africa, eastern boundary, flows north* | |
| **Atoll** (5) vs **guyot** (4+) | *ring of coral around a lagoon / last stage of reef development* → atoll; *flat-topped seamount* → guyot | |
| **Abyssal plain** (5) | *flattest surface on Earth / deep-sea floor sediment blanket* | |
| **Turbidity current** (4) | *submarine canyons*; *deep-sea fans*; *greywacke / turbidites* | |
| **Langmuir circulation** (4+) | *windrows*, *counter-rotating vortices*, *lines of seaweed/foam* | |
| **Carbonate compensation depth** (8 records) | *below it calcareous sediments cannot accumulate / dissolve* | Below the CCD, *what ooze dominates* → siliceous ooze |
| **Siliceous ooze** (8 records) | *below the CCD*; *equatorial upwelling*; *fine & glassy* | |

---

## 6. Collision pairs: where early buzzes go wrong

These pairs appear repeatedly in the bank. In every case, the words that tell them apart arrive **late** in the question.

| Pair | Shared lead-in | Deciding word(s) |
|---|---|---|
| Olivine / quartz | "Which mineral lacks / has no cleavage" | **The choices.** The bank has both (2× olivine, 1× quartz as a *silicate* with no cleavage) |
| Hydrogen / silicon / Chandrasekhar / white dwarf | "Type I(a) supernova…" | *lacks* / *presence of* / *limit* / *object* |
| CNO cycle / pp chain | "Fusion of hydrogen into helium in stars…" | The mass: *> 1.3 M☉* vs *the Sun* |
| Hayashi / Henyey | "Pre-main-sequence track…" | *vertical, convective* vs *horizontal, radiative* |
| Helium / hydrogen (pulsation) | "Pulsation caused by ionization of…" | *double ionization / instability strip* → He; *Eddington valve / Mira* → H |
| Methane / nitrogen (Titan, Pluto) | "Titan… composed of…" | *lakes / clouds* → CH₄; *atmosphere* → N₂; *Pluto glaciers* → N₂ |
| Chromatic / spherical aberration | "In refracting telescopes…" | *colors / wavelengths* vs *edges / mirror shape* |
| Pulsar / magnetar | "Rotating neutron star…" | *beam / lighthouse / glitch* vs *magnetic field / starquake / SGR* |
| Oort / Kuiper | "Comets originate…" | *long* vs *short* period |
| Lenticular galaxy / cloud | "Lens-shaped…" | *S0 / Hubble* vs *leeward of mountains / UFO* |
| Parabolic dune / mirror / orbit | "Parabolic…" | *vegetation / coast* vs *X-rays* vs *escape velocity* |
| Basalt / gabbro | "Mafic igneous rock…" | *extrusive / fine* vs *intrusive / coarse* |
| Limestone / calcite | "Fizzes in acid / karst…" | *rock* vs *mineral* |
| Dike / sill / laccolith | "Tabular igneous intrusion…" | *discordant* vs *concordant* vs *domed* |
| Non- / dis- / angular / paraconformity | "What type of unconformity…" | The lower unit's rock type and orientation |
| Pycnocline / thermocline / halocline | "Ocean layer where … changes rapidly with depth" | *density* / *temperature* / *salinity* |
| Neap / spring tide | "Tides when the Sun and Moon…" | *right angles / quarter* vs *aligned / new / full* |
| Oxbow lake / Rossby wave | "Meander…" | *river* vs *jet stream* |
| Stratosphere / troposphere / mesosphere / thermosphere | "In what layer…" | The phenomenon: ozone / weather / meteors / aurora |

---

## 7. Practice plan

1. **Anchor drills (astronomy first).** Use the Catalog with subject = Earth & Space and format = Short Answer, and search the anchors in §5.1. Say the answer **at the anchor**, then check whether the ask agreed. Track how often it didn't: that's your personal neg rate for that anchor.
2. **Collision-pair flashcards.** Make one card per row of §6, with the shared lead-in on the front and the deciding word on the back.
3. **Solo mode at the fastest reading speed**, ESS only, tossups only. Aim to buzz on SA term questions before 70% of the text has been read, with a neg rate under 10%.
4. **MC timing.** In Solo, practise buzzing as soon as you hear the correct choice. Skip that on NOT/EXCEPT/LEAST stems, where you should confirm every earlier choice first.
5. **List questions.** Practise saying the numbers aloud as each statement finishes, so your answer is ready the moment the last statement ends.

---

## Appendix: method

- **Source:** `data/questions.json`, filtered to `s == "ess"` (11,629 records).
- **De-duplication:** records were keyed on the first 120 alphanumeric characters of the lower-cased question text, which gives 10,886 unique questions.
- **Answer normalization:** upper-case; bracketed text and anything after ACCEPT, DO NOT ACCEPT, PROMPT or `;` dropped; leading articles dropped; a trailing plural `s` stripped. List answers (e.g. `1 AND 3`, `ALL`) were excluded from the concept counts.
- **Tossup kinds:** regular expressions on the question text: *identify all / all of the following*; *rank / order / arrange*; MC with *not / except / least*; SA with units or *calculate / how many*; everything else is a term question.
- **Ask position:** the index of the last *what / which / name / identify / give* token divided by the question's word count, over 1,861 SA term tossups. The median is 0.22, and 38% of questions have the ask in the second half.
- **Anchor precision:** over unique short-answer, non-list questions containing the anchor regex. Precision is the share whose answer matches the expected answer family. Position is where the anchor appears, as a share of the question's words.
- **Topic classifier:** keyword counts per area, where the area with the highest count wins. It is approximate and is only used for the topic-mix table and to group answers.
- **Penalty model:** tossup = 4, bonus = 10, interrupt penalty = 4. `V = 4 + 10b` with `b = 0.6`; the opponent converts after a neg with `q = 0.8`. The comparison is the swing in expected points against waiting for the question to finish.
