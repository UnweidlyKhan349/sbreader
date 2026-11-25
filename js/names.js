/* SB Reader - random names for a new room ("casparian-tholins", the lobby's
   placeholder) and for a first-time player ("Casparian Tholins").

   The words come from the club's word bank of Science Bowl terms: the
   "SciBowl stock" and "ESS only" lists (the USESO rocks and minerals list is
   left out, and so are the rocks it names that the ESS list repeats). A name
   reads like a term of its own: a describing word, then a noun. The noun is
   one a term ends on ("strip" in "Casparian strip", "tholins"); the
   describing word is one that comes before a term's noun ("Casparian",
   "Okazaki", "thermal"). Filler like "law" or "effect" is skipped, and the
   two words never sit in the same term, so they're unrelated rather than
   half of "Hardy-Weinberg". No DOM, so the tests run it under Node. */
(function (global) {
  const TERMS = [
    // SciBowl stock
    'ABC hypothesis', 'AM-GM inequality', "Ampere's law", 'Amphoteric', 'Apoptosis', 'Arete', 'Arrhenius equation', 'Associativity', 'Asteroid',
    'Band gap', 'Barr body', 'Beta oxidation', 'Biot-Savart law', 'Boiling point elevation', 'Born-Haber cycle', 'Bottleneck effect',
    "Bowen's reaction series", "Boyle's law", "Brewster's angle", 'Brine rejection', 'Casparian strip', 'Caspases', 'Cauchy-Schwarz inequality',
    'Cell membrane', 'Center of mass', 'Cepheid variables', 'Chandrasekhar limit', 'Cherenkov radiation', 'Chicken McNugget theorem',
    'Chinese remainder theorem', 'Chlorophyll', 'Chloroplast', 'Circle', 'Cirque', 'Clausius-Clapeyron equation', 'Columnar jointing', 'Comet',
    'Common ion effect', 'Commutativity', 'Compton scattering', 'Conjugation', 'Cooperativity', 'Cori cycle', 'Crystal field theory',
    'Cyclic amperes', 'Cyclin-dependent kinase', 'Cyclotron radiation', 'Cytochrome c', 'Daniell cell', 'De Broglie wavelength', 'Derivative',
    'Determinant', 'Diamagnetism', 'Diastereomer', 'Diels-Alder reaction', 'Directional selection', 'Disruptive selection', 'Doppler effect',
    'Drumlin', 'Dynein', 'E1', 'E2', 'Earth', 'Ekman transport', 'El Nino Southern Oscillation', 'Enantiomer', 'Enceladus', 'Enthalpy', 'Entropy',
    'Equipotential', 'Esker', 'Europa', "Faraday's law", "Fermat's little theorem", 'Ferrel cell', 'Fluid mosaic model', 'Founder effect',
    'Freezing point depression', 'G-protein coupled receptor', "Gauss's law", 'Geostrophic wind', 'Gibbs free energy', 'Gradient', 'Hadley cell',
    'Halocline', 'Hard-soft acid-base theory', 'Hardy-Weinberg equilibrium', 'Helicase', 'Helmholtz free energy', 'Henderson-Hasselbalch equation',
    "Henry's law", "Hess's law", 'Hexagon', 'Hofmann product', 'Hot Jupiter', "Hubble's law", "Huckel's rule", "Huntington's disease",
    'Hydrostatic equilibrium', 'Inert pair effect', 'Infrared spectroscopy', 'Inner core', 'Integral', 'Io', 'Isostatic rebound',
    'Jahn-Teller effect', 'Jeans instability', 'Jupiter', "Kepler's laws", 'Kinesin', "Kirchhoff's junction rule", "Kirchhoff's loop rule",
    'Lagrange points', 'Lanthanide contraction', 'LC circuit', "Le Chatelier's principle", "Lenz's law", 'Ligase', 'Mars', 'Mass spectrometry',
    'Maxwell-Boltzmann distribution', 'Meissner effect', 'Meso', 'Metal organic frameworks', 'Michaelis-Menten equation', 'Mimas', 'Mitochondria',
    'Molecular orbital theory', 'Moment of inertia', 'Moraine', 'Neptune', 'Nernst equation', 'Neutrinos',
    'Nuclear magnetic resonance spectroscopy', 'Octagon', "Ohm's law", 'Okazaki fragments', 'Orographic lifting', 'Outer core', 'Oxbow lake',
    'Parallax', 'Parallel axis theorem', 'Paramagnetism', 'Pentose phosphate pathway', 'Pericycle', 'Photoelectric effect', 'Photorespiration',
    'Polar cell', 'Poynting vector', 'Pre-exponential factor', 'Primase', 'Pulsar', 'Pycnocline', 'Quantum tunneling', "Raoult's law", 'RC circuit',
    'RL circuit', 'RLC circuit', 'Reaction quotient', 'Receptor tyrosine kinase', 'Recessive epistasis', 'Redshift', 'Relativistic jets',
    'RNA world hypothesis', 'Roche limit', 'Rossby waves', 'Roche moutonnee', 'Saturn', 'Schwarzschild radius', 'Seebeck effect',
    'Shoelace formula', 'Sn1', 'Sn2', "Snell's law", 'Sonic hedgehog protein', 'Square', 'Stabilizing selection', 'Stefan-Boltzmann law', 'Sun',
    'Telomeres', 'Thermal inversion', 'Thermocline', 'Thermohaline circulation', 'Thymine dimers', 'Tidal locking',
    'Tolman-Oppenheimer-Volkoff limit', 'Topoisomerase', 'Total internal reflection', 'Transduction', 'Transformation', 'Turbidity currents',
    'Ubiquitin', 'Ultraviolet catastrophe', 'Upwelling', 'Uranus', 'Urea cycle', "van 't Hoff equation", 'Wadati-Benioff zone', 'Water',
    "Wien's displacement law", 'Yang cycle', 'Zaitsev product', 'Zeolites',    // ESS only
    'Batholith', 'Sill', 'Laccolith', 'Lopolith', 'Dike', 'Xenolith', 'Angular unconformity', 'Disconformity', 'Nonconformity', 'Paraconformity',
    'Eluviation', 'Leaching', 'Syncline', 'Anticline', 'Graben', 'Horst', 'Scarp', 'Decollement fault', 'Normal fault', 'Reverse fault',
    'Strike-slip fault', 'Oblique-slip fault', 'Dip-slip fault', 'Thrust fault', 'Megathrust fault', 'Karst topography', 'Sinkhole', 'Stalactite',
    'Stalagmite', 'Speleothem', 'Pyroclastic flow', 'Shield volcano', 'Stratovolcano', 'Cinder cone', 'Fumarole', 'Plinian eruption',
    'Phreatic eruption', 'Lahar', 'Alluvial fan', 'Delta', 'Levee', 'Kettle lake', 'U-shaped valley', 'Jokulhlaup', 'Pingo', 'Thermokarst',
    'Terminal moraine', 'Lateral moraine', 'Medial moraine', 'End moraine', 'Fjord', 'Calving', 'Ablation', 'Equilibrium line', 'Barchan dune',
    'Parabolic dune', 'Star dune', 'Barchanoid dune', 'Transverse dune', 'Longitudinal dune', 'Playa', 'Yardang', 'Ventifact', 'Varve',
    'Banded iron formation', 'Foliation', 'Vesicular texture', 'Porphyritic texture', 'Discontinuous branch', 'Continuous branch', 'Chondrite',
    'Achondrite', 'Widmanstatten patterns', 'Greatest western elongation', 'Greatest eastern elongation', 'Inferior conjunction',
    'Superior conjunction', 'Opposition', 'Encke gap', 'Cassini division', 'Io plasma torus', 'Metallic hydrogen', 'Regolith', 'Ejecta blanket',
    'Rille', 'Lunar maria', 'Roche lobe', 'Jeans mass', 'Yarkovsky effect', "Yarkovsky-O'Keefe-Radzievskii-Paddack effect", 'Penitentes', 'Tholins',
    'Orbital resonance', 'Nadir', 'Zenith', 'Bok globule', 'Herbig-Haro object', 'Open cluster', 'Globular cluster', 'Wolf-Rayet star',
    'Kozai-Lidov effect', 'Turnoff point', 'Birthline', 'Zero-age main sequence', 'Zombie star', 'Black dwarf', 'Gravitational lensing',
    'Gravitational wave', 'Sachs-Wolfe effect', 'Tully-Fisher relation', 'Faber-Jackson relation', 'Babcock model', 'Centaurs', 'Trojans', 'Theia',
    'Poynting-Robertson effect', 'Saros cycle', 'Lunar eclipse', 'Solar eclipse', 'Transit', 'Oort cloud', 'Kuiper belt', 'Heliopause', 'Bow shock',
    'Heliosheath', 'Solar wind', 'Coronal mass ejection', 'Solar flare', 'Sunspot', 'Chromosphere', 'Photosphere', 'Corona', 'Prominence',
    'Granulation', 'Supergranulation', 'Hertzsprung-Russell diagram', 'Hayashi track', 'Henyey track', 'Instability strip',
    'Asymptotic giant branch', 'Red giant branch', 'Blue loop', 'Red clump', 'Helium flash', 'CNO cycle', 'Proton-proton chain',
    'Triple-alpha process', 'Eclipsing binary', 'Spectroscopic binary', 'Visual binary', 'Contact binary', 'T-Tauri star', 'Mira variable',
    'Luminous blue variable', 'Main sequence', 'Red giant', 'White dwarf', 'Neutron star', 'Dredge-up', 'Magnetar', 'Black hole', 'Event horizon',
    'Accretion disk', 'Ergosphere', 'Penrose process', 'Quasar', 'Blazar', 'Seyfert galaxy', 'Hubble tuning fork diagram', 'Elliptical galaxy',
    'Lenticular galaxy', 'Spiral galaxy', 'Flocculent galaxy', 'Barred galaxy', 'Grand design galaxy', 'Multi-arm galaxy',
    'Active galactic nucleus', 'Nova', 'Supernova', 'Hypernova', 'Kilonova', 'Type 1a supernova', 'Nebula', 'Planetary nebula', 'Emission nebula',
    'Dark nebula', 'Reflection nebula', 'Mie scattering', 'Rayleigh scattering', 'Protostar', 'Brown dwarf', 'Cepheid variable', 'Blueshift',
    "Olbers' paradox", 'Cosmic microwave background radiation', 'Dark matter', 'Dark energy', 'Inflation theory', 'Horizon problem',
    'Flatness problem', 'Monopole problem', 'Big Bang', 'Big Crunch', 'Big Bounce', 'Big Rip', 'Heat death', 'Vacuum decay', 'Retrograde motion',
    'Sidereal period', 'Synodic period', 'Perihelion', 'Aphelion', 'Oberth effect', 'Hohmann transfer', 'Eccentricity', 'Precession', 'Obliquity',
    'Nutation', 'Libration', 'Occultation', 'Syzygy', 'Neap tide', 'Spring tide', 'Umbra', 'Antumbra', 'Annular eclipse', "Baily's beads",
    'Diamond ring effect', 'Zodiacal light', 'Aurora', 'Van Allen belts', 'Magnetosphere', 'Ionosphere', 'Stratosphere', 'Mesosphere',
    'Thermosphere', 'Exosphere', 'Tropopause', 'Ozone layer', 'Jet stream', 'Kelvin-Helmholtz instability', 'Coriolis effect', 'Boundary layer',
    'Katabatic wind', 'Chinook wind', 'Foehn wind', 'Urban heat island effect', 'Sea breeze', 'Land breeze', 'Squall line', 'Derecho', 'Microburst',
    'Downburst', 'Supercell', 'Storm surge', 'Tornado', 'Mesocyclone', 'Cyclone', 'Anticyclone', 'Eyewall', 'Saffir-Simpson scale', 'Fujita scale',
    'Enhanced Fujita scale', 'Isobar', 'Isotherm', 'Isochron', 'Isopycnal', 'Adiabatic lapse rate', 'Dry adiabatic lapse rate',
    'Wet adiabatic lapse rate', 'Environmental lapse rate', 'Dew point lapse rate', 'Absolute stability', 'Conditional instability',
    'Absolute instability', 'Neutral stability', 'Dew point', 'Relative humidity', 'Cumulonimbus', 'Virga', 'Graupel', 'Sleet', 'Rain',
    'Freezing rain', 'Rime', 'Hail', 'Snow', 'Occluded front', 'Stationary front', 'Warm front', 'Cold front', 'Dry line', 'Omega block',
    'Antarctic bottom water', 'Iceberg', 'Downwelling', 'Amphidromic point', 'Tidal bore', 'Tidal resonance', 'Transgression', 'Stream piracy',
    'Regression', 'Cyclothem', 'Regelation', 'Superior mirage', 'Inferior mirage', 'Emerging coast', 'Submerging coast', 'Seiche', 'Kelvin wave',
    'Sverdrup circulation', 'Ekman spiral', 'Gyre', 'Eddy', 'Polynya', 'Rip current', 'Longshore drift', 'Spit', 'Tombolo', 'Barrier island',
    'Baymouth bar', 'Estuary', 'V-shaped valley', 'Continental shelf', 'Continental rise', 'Continental slope', 'Submarine canyon', 'Abyssal plain',
    'Trench', 'Subduction zone', 'Transform boundary', 'Divergent boundary', 'Convergent boundary', 'Rift valley', 'Mid-ocean ridge',
    'Volcanic arc', 'Island arc', 'Triple junction', 'Paleomagnetism', 'Magnetic reversal', 'Isostasy', 'Mohorovicic discontinuity',
    'Gutenberg discontinuity', 'Lehmann discontinuity', 'Conrad discontinuity', 'Repetti discontinuity', 'Core-mantle boundary', 'Asthenosphere',
    'Lithosphere', 'Cleavage', 'Fracture', 'Luster', 'Streak', 'Hardness', 'Specific gravity', 'Crystal habit', 'Mohs scale', 'Silicate',
    'Carbonate', 'Evaporite', 'Clastic sediment', 'Chemical sediment', 'Biogenic sediment', 'Cross-bedding', 'Graded bedding', 'Ripple marks',
    'Mud cracks', 'Fossil succession', 'Radiometric dating', 'Concordia line', 'Half-life', 'Index fossil', 'Superposition',
    'Cross-cutting relation', 'Metamorphic aureole', 'Metasomatism', 'Contact metamorphism', 'Burial metamorphism', 'Shock metamorphism',
    'Regional metamorphism', 'Metamorphic facies', 'Zeolite', 'Accretionary wedge', 'Partial melting', 'Flux melting', 'Decompression melting',
    'Crenulation', 'Diaphaneity', 'Pleochroism', 'Pressure solution', 'Crystalloblastic series', 'Goldich dissolution series', 'Exfoliation dome',
    'Hummocky-swale cross-stratification',  ];
  // Words that say what kind of term it is rather than which one, and a
  // few that make an odd name on their own.
  const FILLER = new Set([
    'the', 'of', 'de', 'el', 'le', 'van', 'up', 'law', 'laws', 'effect', 'theorem', 'equation', 'cycle', 'rule', 'principle', 'inequality', 'hypothesis',
    'series', 'reaction', 'process', 'theory', 'model', 'relation', 'diagram', 'scale', 'product', 'problem', 'formula', 'pathway',
    'type', 'shaped', 'multi', 'pre', 'mid', 'dredge', 'cutting', 'moutonnee',
    'diamond', // a mineral on the USESO list ("Diamond ring effect" keeps "Ring")
  ]);
  // Terms of one word are nouns, except these, which describe.
  const DESCRIBING_ALONE = new Set(['amphoteric', 'meso']);
  // Every usable word, as it's shown ("McNugget", "O'Keefe"), with the terms
  // it comes from and whether it can go first (describing), second (the
  // noun), or either ("spiral": "Spiral galaxy", "Ekman spiral"). Possessives
  // lose their "'s"; abbreviations (ABC, RNA), single letters and anything
  // but letters ("E1", "'t") are left out.
  const WORDS = (() => {
    const found = new Map();
    TERMS.forEach((term, i) => {
      const parts = term.split(/[\s-]+/).map((w) => w.replace(/'s?$/, ''));
      const of = parts.indexOf('of');
      parts.forEach((w, j) => {
        if (w.length < 2 || !/^[A-Za-z][A-Za-z']*$/.test(w) || /^[A-Z]+$/.test(w) || FILLER.has(w.toLowerCase())) return;
        const key = w.toLowerCase();
        if (!found.has(key)) found.set(key, { word: w[0].toUpperCase() + w.slice(1), terms: new Set(), first: false, second: false });
        const entry = found.get(key);
        entry.terms.add(i);
        // A term's noun is its last word, or in "Center of mass" the words
        // on either side of "of".
        const noun = j === parts.length - 1 || (of > 0 && j >= of - 1);
        if (noun && !DESCRIBING_ALONE.has(key)) entry.second = true;
        else entry.first = true;
      });
    });
    return [...found.values()];
  })();
  const FIRST = WORDS.filter((w) => w.first);
  const SECOND = WORDS.filter((w) => w.second);
  const MAX_NAME = 24; // SBMpRules.LIMITS.name

  // A describing word and a noun from different terms, as shown
  // ("Casparian", "Tholins"), that fit in a player name with a space between.
  function randomPair(rand) {
    const r = rand || Math.random;
    const pick = (list) => list[Math.floor(r() * list.length)];
    for (;;) {
      const a = pick(FIRST);
      const b = pick(SECOND);
      if (a.word.length + 1 + b.word.length > MAX_NAME) continue;
      if ([...a.terms].some((t) => b.terms.has(t))) continue;
      return [a.word, b.word];
    }
  }
  function playerName(rand) { return randomPair(rand).join(' '); }
  // Lower case with dashes, letters only ("o'keefe" loses its apostrophe).
  function roomName(rand) { return randomPair(rand).join('-').toLowerCase().replace(/[^a-z-]/g, ''); }

  global.SBNames = { TERMS, WORDS, FIRST, SECOND, MAX_NAME, randomPair, playerName, roomName };
})(typeof window !== 'undefined' ? window : globalThis);
