// ============================================================================
// STEAMPATH — INTERFACE: formulário, steampath visual, triângulos de
// velocidade, gráficos e tabela.
// ============================================================================
(function () {
  const CHART_COLORS = ['#5B8DB8', '#C08A3E', '#6FA97A', '#B47FC0', '#D97A3D', '#9A7FD1'];
  const GRID = 'rgba(255,255,255,0.06)';
  const TICK = '#9AA4B2';

  Chart.defaults.color = TICK;
  Chart.defaults.font.family = "'IBM Plex Mono', monospace";
  Chart.defaults.font.size = 11;

  function newStage() {
    return {
      extractionKgh: 0, sectorLossPct: 0,
      nozzle: {
        name: '', profileType: '', mountAngle: 0,
        type: 'diafragma', // 'diafragma' (passo calculado) ou 'injetor' (passo é dado, arco parcial)
        dm: '', l: '', b: '', z: '', za: '', t: '',
        zetaPct: 10, hs: 0, e: ''
      },
      rotor: {
        name: '', profileType: '', mountAngle: 0,
        dm: '', l: '', b: '', z: '',
        rootType: '', material: '',
        zetaPct: 15, R: '', collar: '', headHeight: '',
        e: '' // β2e não é mais um campo — é sempre calculado (ver engine.js)
      },
      seals: { zj: '', delta: '', bigDelta: '', deltaR: '', deltaA: '', zr: 0, deltaDiscDiaphragm: '', sealDiam: '', psi: 0.75 },
      eqHoles: { diameter: '', qty: '', pitchDiameter: '' },
      diaphragm: {
        OD: '', Od: '', bt: '', materialBody: '', materialProfile: '',
        d1n: '', d2n: '', dExtr: ''
      },
      discardExitKE: false, kFriction: 1.1, kThrust: 0.95, miR: ''
    };
  }

  const OPTS = {
    nozzleProfile: ['17UE', '17DH', 'TX', 'DK'],
    rotorProfile: ['2A', '3A', '4A'],
    rootType: ['Especial', 'NIB16', 'NIB20', 'NIB25', 'NIB32', 'NIB40', 'NIB45', 'NIB50', 'NIB56', 'NIB63', 'NIB71', 'NIB85', 'HG9', 'HG11', 'HG13', 'HG16', 'HG20', 'HG25', 'Texas 1', 'Texas 2'],
    bladeMaterial: ['X22CRMOV12-1', 'X20CRMO13', 'X22CRMOV12-1 SEW 670-69', '34CRNIMO6', 'AISI 410', 'AISI 420', 'AISI 431'],
    diaphragmBody: ['SA217 WC1', 'SA217 WC6', 'SA216 WCB'],
    controlWheel: ['Rateau', 'Curtis', 'Ação simples', 'Reação (sem roda de regulagem)']
  };
  function datalist(id, arr) { return `<datalist id="${id}">${arr.map(o => `<option value="${o}">`).join('')}</datalist>`; }

  function newAkDevice() { return { dak: '', akStage: '1', akLabyrinthDiam: '', akSealTeeth: '' }; }

  let state = {
    tipo: '', os: '', cliente: '',
    n_rpm: '', P_adm_bar: '', T_adm_degC: '', P_exh_bar: '', mdot_kgh: '',
    gearboxEffPct: 98.5, generatorEffPct: 96, valveLossPct: 5, kGas: 1.3,
    tolConsumoPct: 3, flangeAdmIn: '', flangeExhIn: '', controlWheelType: 'Rateau',
    injectionGroups: '', // definição da máquina (só se algum estágio usa bocal tipo "Injetor")
    thrustPadDe: '', thrustPadDi: '', thrustPadAlpha: 0.9, thrustPadAreaOverride: '',
    akDevices: [],
    stages: [newStage()]
  };
  let result = null;
  let charts = {};
  let triStageIdx = 0;

  function v(x) { return (x === '' || x === null || x === undefined) ? '' : x; }
  function num(x) { const n = parseFloat(x); return isNaN(n) ? NaN : n; }

  // ---------------- Formulário (sidebar) ----------------
  function renderSidebar() {
    const el = document.getElementById('sidebar');
    el.innerHTML = `
      <div class="brand">
        <div class="mark">SP</div>
        <h1>STEAMPATH</h1>
      </div>
      <div class="sub">Linha de expansão multiestágio — ação/reação</div>

      <div class="field-group">
        <h2>Identificação</h2>
        <div class="row">
          <div><label>Turbina</label><input type="text" id="f-tipo" value="${v(state.tipo)}"></div>
          <div><label>OS</label><input type="text" id="f-os" value="${v(state.os)}"></div>
        </div>
        <div><label>Cliente</label><input type="text" id="f-cliente" value="${v(state.cliente)}"></div>
      </div>

      <div class="field-group">
        <h2>Condições operacionais</h2>
        <div class="row">
          <div><label>Rotação n <span class="unit">(rpm)</span></label><input type="number" step="1" id="f-n" value="${v(state.n_rpm)}"></div>
          <div><label>Vazão <span class="unit">(kg/h)</span></label><input type="number" step="1" id="f-mdot" value="${v(state.mdot_kgh)}"></div>
        </div>
        <div class="row">
          <div><label>Pressão admissão <span class="unit">(bara)</span></label><input type="number" step="0.01" id="f-padm" value="${v(state.P_adm_bar)}"></div>
          <div><label>Temperatura admissão <span class="unit">(°C)</span></label><input type="number" step="0.1" id="f-tadm" value="${v(state.T_adm_degC)}"></div>
        </div>
        <div class="row">
          <div><label>Pressão de escape <span class="unit">(bara)</span></label><input type="number" step="0.01" id="f-pexh" value="${v(state.P_exh_bar)}"></div>
          <div><label>Perda na válvula (chute) <span class="unit">(%)</span></label><input type="number" step="0.1" id="f-valveloss" value="${v(state.valveLossPct)}"></div>
        </div>
        <div class="row">
          <div><label>Rendimento redutor <span class="unit">(%)</span></label><input type="number" step="0.1" id="f-geff" value="${v(state.gearboxEffPct)}"></div>
          <div><label>Rendimento gerador <span class="unit">(%)</span></label><input type="number" step="0.1" id="f-generatoreff" value="${v(state.generatorEffPct)}"></div>
        </div>
        <div class="row">
          <div><label>Expoente isentrópico k <span class="unit">(vapor)</span></label><input type="number" step="0.01" id="f-kgas" value="${v(state.kGas)}"></div>
          <div><label>Tol. consumo <span class="unit">(%)</span></label><input type="number" step="0.1" id="f-tolconsumo" value="${v(state.tolConsumoPct)}"></div>
        </div>
        <div class="row">
          <div><label>Flange admissão <span class="unit">(pol)</span></label><input type="number" step="0.5" id="f-flangeadm" value="${v(state.flangeAdmIn)}"></div>
          <div><label>Flange escape (eq) <span class="unit">(pol)</span></label><input type="number" step="0.5" id="f-flangeexh" value="${v(state.flangeExhIn)}"></div>
        </div>
        <div class="row">
          <div><label>Tipo de roda de regulagem</label><input type="text" list="dl-controlwheel" id="f-controlwheel" value="${v(state.controlWheelType)}"></div>
          <div><label>Grupos de injeção n <span class="unit">(se houver bocal tipo Injetor)</span></label><input type="number" step="1" id="f-injectiongroups" value="${v(state.injectionGroups)}"></div>
        </div>
        <div class="hint">A perda de válvula é o palpite inicial — o laço de convergência (metodologia de continuidade) ajusta esse valor até a marcha estágio-a-estágio fechar exatamente na pressão de escape informada, dado o palhetamento de cada estágio. "Tol. consumo" define a tolerância física (em % da pressão de escape) usada para considerar essa convergência fechada. "Grupos de injeção" é uma definição da máquina (quantos grupos de bicos/válvulas de regulagem existem), não de um estágio específico — só faz sentido quando algum estágio usa bocal fixo do tipo "Injetor" (ver o card do estágio); um diafragma não tem grupos de injeção.</div>
      </div>

      <div class="field-group">
        <h2>Mancal axial (encosto)</h2>
        <div class="row">
          <div><label>Ø maior da pastilha De <span class="unit">(mm)</span></label><input type="number" step="0.1" id="f-thrustde" value="${v(state.thrustPadDe)}"></div>
          <div><label>Ø menor da pastilha Di <span class="unit">(mm)</span></label><input type="number" step="0.1" id="f-thrustdi" value="${v(state.thrustPadDi)}"></div>
        </div>
        <div class="row">
          <div><label>Fator de cobrimento α</label><input type="number" step="0.01" id="f-thrustalpha" value="${v(state.thrustPadAlpha)}"></div>
          <div><label>Área do mancal (se já conhecida) <span class="unit">(mm²)</span></label><input type="number" step="1" id="f-thrustareaoverride" value="${v(state.thrustPadAreaOverride)}"></div>
        </div>
        <div class="hint">Área = α·π/4·(De²−Di²), a menos que você informe a área diretamente. Usada para converter o empuxo axial resultante (N) em pressão específica no mancal (MPa) — mesma conta da planilha original ("Empuxo Axial Específico").</div>
      </div>

      <div class="field-group" id="ak-group">
        <h2>Pistão(ões) de compensação (AK)</h2>
        <div id="ak-cards"></div>
        <button class="btn" id="btn-add-ak">+ adicionar pistão de compensação</button>
        <div class="hint">Não é um dado do estágio — é uma característica da máquina. Cada pistão forma um degrau da mesma cadeia (ordem = a ordem em que aparecem aqui); o diâmetro-base do primeiro degrau é o Ø depois do disco (d2n) do 1º estágio, em "Geometria do diafragma".</div>
      </div>

      ${datalist('dl-controlwheel', OPTS.controlWheel)}
      ${datalist('dl-nozzleprofile', OPTS.nozzleProfile)}
      ${datalist('dl-rotorprofile', OPTS.rotorProfile)}
      ${datalist('dl-roottype', OPTS.rootType)}
      ${datalist('dl-bladematerial', OPTS.bladeMaterial)}
      ${datalist('dl-diaphragmbody', OPTS.diaphragmBody)}

      <div class="field-group" id="stages-group">
        <h2>Estágios</h2>
        <div id="stage-cards"></div>
        <button class="btn" id="btn-add-stage">+ adicionar estágio</button>
      </div>

      <button class="btn-primary" id="btn-calc">Calcular linha de expansão</button>
    `;
    renderStageCards();
    renderAkCards();

    document.getElementById('btn-add-stage').onclick = () => { readForm(false); state.stages.push(newStage()); renderStageCards(); };
    document.getElementById('btn-add-ak').onclick = () => { readForm(false); state.akDevices.push(newAkDevice()); renderAkCards(); };
    document.getElementById('btn-calc').onclick = () => { readForm(); recalc(); };
    ['f-tipo','f-os','f-cliente','f-n','f-mdot','f-padm','f-tadm','f-pexh','f-valveloss','f-geff','f-generatoreff','f-kgas','f-tolconsumo','f-flangeadm','f-flangeexh','f-controlwheel','f-injectiongroups','f-thrustde','f-thrustdi','f-thrustalpha','f-thrustareaoverride'].forEach(id => {
      const elm = document.getElementById(id);
      if (elm) elm.addEventListener('change', () => readForm());
    });
  }

  function calcPitch(dm, z) { return (dm && z) ? (Math.PI * dm / z) : null; }

  function renderAkCards() {
    const wrap = document.getElementById('ak-cards');
    if (!wrap) return;
    wrap.innerHTML = state.akDevices.map((ak, idx) => `
      <div class="stage-card" data-idx="${idx}">
        <div class="stage-card-head">
          <h3>Pistão de compensação ${idx + 1}</h3>
          <button class="icon-btn" data-remove-ak="${idx}" title="Remover">✕</button>
        </div>
        <div class="row">
          <div><label>Ø do pistão dak <span class="unit">(mm)</span></label><input type="number" step="0.1" class="ak-field" data-k="dak" data-idx="${idx}" value="${v(ak.dak)}"></div>
          <div><label>Estágio onde o AK liga</label><input type="number" step="1" min="1" class="ak-field" data-k="akStage" data-idx="${idx}" value="${v(ak.akStage)}"></div>
        </div>
        <div class="row">
          <div><label>Ø do labirinto do AK <span class="unit">(mm)</span></label><input type="number" step="0.1" class="ak-field" data-k="akLabyrinthDiam" data-idx="${idx}" value="${v(ak.akLabyrinthDiam)}"></div>
          <div><label>Fitas de selagem do AK</label><input type="number" step="1" class="ak-field" data-k="akSealTeeth" data-idx="${idx}" value="${v(ak.akSealTeeth)}"></div>
        </div>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-remove-ak]').forEach(btn => {
      btn.onclick = () => { readForm(false); state.akDevices.splice(parseInt(btn.dataset.removeAk), 1); renderAkCards(); };
    });
  }

  function renderStageCards() {
    const wrap = document.getElementById('stage-cards');
    wrap.innerHTML = state.stages.map((s, idx) => {
      const isInjetor = s.nozzle.type === 'injetor';
      const pitchCalc = calcPitch(s.nozzle.dm, s.nozzle.z);
      const beta2Calc = (typeof Engine !== 'undefined' && Engine.calcBladeAngleDeg) ? Engine.calcBladeAngleDeg(s.rotor.z, s.rotor.e, s.rotor.dm) : null;
      return `
      <div class="stage-card" data-idx="${idx}">
        <div class="stage-card-head">
          <h3>Estágio ${idx + 1}</h3>
          ${state.stages.length > 1 ? `<button class="icon-btn" data-remove="${idx}" title="Remover">✕</button>` : ''}
        </div>

        <div class="row">
          <div><label>Vazão de tomada (extração) <span class="unit">(kg/h)</span></label><input type="number" step="1" class="s-top" data-k="extractionKgh" data-idx="${idx}" value="${v(s.extractionKgh)}"></div>
          <div><label>Perda por setor <span class="unit">(%)</span></label><input type="number" step="0.1" class="s-top" data-k="sectorLossPct" data-idx="${idx}" value="${v(s.sectorLossPct)}"></div>
        </div>

        <div class="subsection">
          <div class="sub-title">Bocal fixo</div>
          <div class="row">
            <div><label>Tipo de bocal fixo</label>
              <select class="s-field s-recalc" data-grp="nozzle" data-k="type" data-idx="${idx}">
                <option value="diafragma" ${!isInjetor ? 'selected' : ''}>Diafragma</option>
                <option value="injetor" ${isInjetor ? 'selected' : ''}>Injetor</option>
              </select>
            </div>
            <div><label>Perfil (nome)</label><input type="text" class="s-field" data-grp="nozzle" data-k="name" data-idx="${idx}" value="${v(s.nozzle.name)}" placeholder="ex.: 17UE32-0"></div>
          </div>
          <div class="row">
            <div><label>Tipo de perfil</label><input type="text" list="dl-nozzleprofile" class="s-field" data-grp="nozzle" data-k="profileType" data-idx="${idx}" value="${v(s.nozzle.profileType)}"></div>
            <div><label>Ângulo de montagem βm <span class="unit">(°)</span></label><input type="number" step="0.1" class="s-field" data-grp="nozzle" data-k="mountAngle" data-idx="${idx}" value="${v(s.nozzle.mountAngle)}"></div>
          </div>
          <div class="row">
            <div><label>Ø médio dm1 <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field s-recalc" data-grp="nozzle" data-k="dm" data-idx="${idx}" value="${v(s.nozzle.dm)}"></div>
            <div><label>Altura l1 <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="nozzle" data-k="l" data-idx="${idx}" value="${v(s.nozzle.l)}"></div>
          </div>
          <div class="row">
            <div><label>Corda b1 <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="nozzle" data-k="b" data-idx="${idx}" value="${v(s.nozzle.b)}"></div>
            <div><label>${isInjetor ? 'Bicos abertos z1a' : 'Palhetas abertas z1a'}</label><input type="number" step="1" class="s-field" data-grp="nozzle" data-k="za" data-idx="${idx}" value="${v(s.nozzle.za)}"></div>
          </div>
          <div class="row">
            <div><label>${isInjetor ? 'Nº de bicos z1' : 'Nº de palhetas z1'}</label><input type="number" step="1" class="s-field s-recalc" data-grp="nozzle" data-k="z" data-idx="${idx}" value="${v(s.nozzle.z)}"></div>
            <div><label>Garganta e1 <span class="unit">(mm)</span></label><input type="number" step="0.01" class="s-field" data-grp="nozzle" data-k="e" data-idx="${idx}" value="${v(s.nozzle.e)}"></div>
          </div>
          <div class="row">
            ${isInjetor
              ? `<div><label>Passo t1 <span class="unit">(mm) — dado (arco parcial)</span></label><input type="number" step="0.01" class="s-field" data-grp="nozzle" data-k="t" data-idx="${idx}" value="${v(s.nozzle.t)}"></div>`
              : `<div><label>Passo t1 <span class="unit">(mm) — calculado: π·dm1/z1</span></label><input type="text" class="mono" value="${pitchCalc != null ? pitchCalc.toFixed(2) : '—'}" readonly style="opacity:.75;"></div>`}
            <div><label>Perda de perfil ζ'n <span class="unit">(%)</span></label><input type="number" step="0.1" class="s-field" data-grp="nozzle" data-k="zetaPct" data-idx="${idx}" value="${v(s.nozzle.zetaPct)}"></div>
          </div>
          <div class="hint">${isInjetor
            ? 'Injetor: o passo é um dado (bicos avulsos cobrindo só parte do arco — típico do estágio de regulagem). A quantidade de grupos de injeção é definida uma vez para a máquina toda, lá em cima em "Condições operacionais".'
            : 'Diafragma: anel de pás em todo o arco (360°) — o passo é sempre π·dm1/z1, calculado automaticamente, não é um dado independente.'}</div>
          <label class="chk"><input type="checkbox" class="s-top" data-k="discardExitKE" data-idx="${idx}" ${s.discardExitKE ? 'checked' : ''}> Descartar energia cinética de saída (não recuperada no próximo estágio)</label>
        </div>

        <div class="subsection">
          <div class="sub-title">Palheta móvel (rotor)</div>
          <div class="row">
            <div><label>Perfil (nome)</label><input type="text" class="s-field" data-grp="rotor" data-k="name" data-idx="${idx}" value="${v(s.rotor.name)}" placeholder="ex.: 3A20-0"></div>
            <div><label>Tipo</label><input type="text" list="dl-rotorprofile" class="s-field" data-grp="rotor" data-k="profileType" data-idx="${idx}" value="${v(s.rotor.profileType)}"></div>
          </div>
          <div class="row">
            <div><label>Ø médio dm2 <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field s-recalc" data-grp="rotor" data-k="dm" data-idx="${idx}" value="${v(s.rotor.dm)}"></div>
            <div><label>Altura l2 <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="rotor" data-k="l" data-idx="${idx}" value="${v(s.rotor.l)}"></div>
          </div>
          <div class="row">
            <div><label>Corda b2 <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="rotor" data-k="b" data-idx="${idx}" value="${v(s.rotor.b)}"></div>
            <div><label>Ângulo de montagem βm <span class="unit">(°)</span></label><input type="number" step="0.1" class="s-field" data-grp="rotor" data-k="mountAngle" data-idx="${idx}" value="${v(s.rotor.mountAngle)}"></div>
          </div>
          <div class="row">
            <div><label>Nº de palhetas z2</label><input type="number" step="1" class="s-field s-recalc" data-grp="rotor" data-k="z" data-idx="${idx}" value="${v(s.rotor.z)}"></div>
            <div><label>Garganta e2 <span class="unit">(mm)</span></label><input type="number" step="0.01" class="s-field s-recalc" data-grp="rotor" data-k="e" data-idx="${idx}" value="${v(s.rotor.e)}"></div>
          </div>
          <div class="row">
            <div><label>Perda de perfil ζ'n <span class="unit">(%)</span></label><input type="number" step="0.1" class="s-field" data-grp="rotor" data-k="zetaPct" data-idx="${idx}" value="${v(s.rotor.zetaPct)}"></div>
            <div><label>Ângulo de saída β2e <span class="unit">(°) — calculado: asin(z2·e2/(π·dm2))</span></label><input type="text" class="mono" value="${beta2Calc != null ? beta2Calc.toFixed(2) : '—'}" readonly style="opacity:.75;"></div>
          </div>
          <div class="hint">β2e não é um dado — no programa original também é calculado a partir da garganta e do passo da palheta móvel, não informado à parte.</div>
          <div class="row">
            <div><label>Tipo de pé</label><input type="text" list="dl-roottype" class="s-field" data-grp="rotor" data-k="rootType" data-idx="${idx}" value="${v(s.rotor.rootType)}"></div>
            <div><label>Material da palheta</label><input type="text" list="dl-bladematerial" class="s-field" data-grp="rotor" data-k="material" data-idx="${idx}" value="${v(s.rotor.material)}"></div>
          </div>
          <div class="row">
            <div><label>Raio perfil/colar R <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="rotor" data-k="R" data-idx="${idx}" value="${v(s.rotor.R)}"></div>
            <div><label>Colar c <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="rotor" data-k="collar" data-idx="${idx}" value="${v(s.rotor.collar)}"></div>
          </div>
          <div class="row">
            <div><label>Altura da cabeça <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="rotor" data-k="headHeight" data-idx="${idx}" value="${v(s.rotor.headHeight)}"></div>
          </div>
          <div class="hint">Tipo de pé, material e ângulos de montagem ainda não entram no cálculo de linha média — ficam guardados no projeto para o módulo de tensão/fadiga da pá (Goodman/SAFE) que vem a seguir no roteiro.</div>
        </div>

        <details class="subsection">
          <summary class="sub-title" style="cursor:pointer;">Folgas internas e labirintos</summary>
          <div class="row">
            <div><label>Nº de fitas de labirinto zj</label><input type="number" step="1" class="s-field" data-grp="seals" data-k="zj" data-idx="${idx}" value="${v(s.seals.zj)}"></div>
            <div><label>Folga do labirinto δ <span class="unit">(mm)</span></label><input type="number" step="0.001" class="s-field" data-grp="seals" data-k="delta" data-idx="${idx}" value="${v(s.seals.delta)}"></div>
          </div>
          <div class="row">
            <div><label>Ø de selagem <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="seals" data-k="sealDiam" data-idx="${idx}" value="${v(s.seals.sealDiam)}"></div>
            <div><label>Coef. de vazão ψ (labirinto)</label><input type="number" step="0.01" class="s-field" data-grp="seals" data-k="psi" data-idx="${idx}" value="${v(s.seals.psi)}"></div>
          </div>
          <div class="row">
            <div><label>Espessura da ponta Δ <span class="unit">(mm)</span></label><input type="number" step="0.01" class="s-field" data-grp="seals" data-k="bigDelta" data-idx="${idx}" value="${v(s.seals.bigDelta)}"></div>
            <div><label>Fitas sobre a palheta zr</label><input type="number" step="1" class="s-field" data-grp="seals" data-k="zr" data-idx="${idx}" value="${v(s.seals.zr)}"></div>
          </div>
          <div class="row">
            <div><label>Folga radial δr <span class="unit">(mm)</span></label><input type="number" step="0.01" class="s-field" data-grp="seals" data-k="deltaR" data-idx="${idx}" value="${v(s.seals.deltaR)}"></div>
            <div><label>Folga axial δa <span class="unit">(mm)</span></label><input type="number" step="0.01" class="s-field" data-grp="seals" data-k="deltaA" data-idx="${idx}" value="${v(s.seals.deltaA)}"></div>
          </div>
          <div class="row">
            <div><label>Folga disco–diafragma <span class="unit">(mm)</span></label><input type="number" step="0.01" class="s-field" data-grp="seals" data-k="deltaDiscDiaphragm" data-idx="${idx}" value="${v(s.seals.deltaDiscDiaphragm)}"></div>
          </div>
          <div class="hint">zj, δ, Ø de selagem e ψ alimentam o vazamento em labirinto (fórmula de Stodola). zj, δ, Δ e a folga disco–diafragma também alimentam o coeficiente k do empuxo axial, junto com os furos de equalização (seção própria) — ver "Atrito de disco e empuxo" abaixo. zr, δr e δa ainda são só registradas.</div>
        </details>

        <details class="subsection">
          <summary class="sub-title" style="cursor:pointer;">Furos de equalização de pressão</summary>
          <div class="row">
            <div><label>Ø do furo <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="eqHoles" data-k="diameter" data-idx="${idx}" value="${v(s.eqHoles.diameter)}"></div>
            <div><label>Quantidade</label><input type="number" step="1" class="s-field" data-grp="eqHoles" data-k="qty" data-idx="${idx}" value="${v(s.eqHoles.qty)}"></div>
          </div>
          <div class="row">
            <div><label>Ø médio (círculo dos furos) <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="eqHoles" data-k="pitchDiameter" data-idx="${idx}" value="${v(s.eqHoles.pitchDiameter)}"></div>
          </div>
          <div class="hint">Alimenta o coeficiente de descarga dos furos (carta MiDes, por interpolação — mesma da planilha original) usado no coeficiente k do empuxo axial, junto com as folgas em "Folgas internas e labirintos" e "Atrito de disco e empuxo" abaixo.</div>
        </details>

        <details class="subsection">
          <summary class="sub-title" style="cursor:pointer;">Geometria do diafragma e pistão de compensação</summary>
          <div class="row">
            <div><label>Ø interno da carcaça ØD <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="diaphragm" data-k="OD" data-idx="${idx}" value="${v(s.diaphragm.OD)}"></div>
            <div><label>Menor Ø do diafragma Ød <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="diaphragm" data-k="Od" data-idx="${idx}" value="${v(s.diaphragm.Od)}"></div>
          </div>
          <div class="row">
            <div><label>Largura anel suporte bt <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="diaphragm" data-k="bt" data-idx="${idx}" value="${v(s.diaphragm.bt)}"></div>
          </div>
          <div class="row">
            <div><label>Material do corpo</label><input type="text" list="dl-diaphragmbody" class="s-field" data-grp="diaphragm" data-k="materialBody" data-idx="${idx}" value="${v(s.diaphragm.materialBody)}"></div>
            <div><label>Material do perfil</label><input type="text" list="dl-bladematerial" class="s-field" data-grp="diaphragm" data-k="materialProfile" data-idx="${idx}" value="${v(s.diaphragm.materialProfile)}"></div>
          </div>
          <div class="row">
            <div><label>Ø antes do disco d1n <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="diaphragm" data-k="d1n" data-idx="${idx}" value="${v(s.diaphragm.d1n)}"></div>
            <div><label>Ø depois do disco d2n <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="diaphragm" data-k="d2n" data-idx="${idx}" value="${v(s.diaphragm.d2n)}"></div>
          </div>
          <div class="row">
            <div><label>Ø labirinto de extração <span class="unit">(mm)</span></label><input type="number" step="0.1" class="s-field" data-grp="diaphragm" data-k="dExtr" data-idx="${idx}" value="${v(s.diaphragm.dExtr)}"></div>
          </div>
          <div class="hint">d2n define o diâmetro de raiz usado na área anular do empuxo axial e é também o diâmetro-base da cadeia de pistões de compensação (seção "Pistão(ões) de compensação" lá em cima, fora dos estágios). ØD, Ød, bt e materiais alimentam o cálculo de carga do diafragma (método de A.M. Val) — ainda não implementado.</div>
        </details>

        <details class="subsection">
          <summary class="sub-title" style="cursor:pointer;">Atrito de disco e empuxo (avançado)</summary>
          <div class="row">
            <div><label>Coef. atrito de disco k</label><input type="number" step="0.1" class="s-top" data-k="kFriction" data-idx="${idx}" value="${v(s.kFriction)}"></div>
            <div><label>Coef. de pressão no disco k <span class="unit">(sem furos/labirinto)</span></label><input type="number" step="0.01" class="s-top" data-k="kThrust" data-idx="${idx}" value="${v(s.kThrust)}"></div>
          </div>
          <div class="row">
            <div><label>Coef. μr entre disco/diafragma <span class="unit">(placeholder)</span></label><input type="number" step="0.01" class="s-top" data-k="miR" data-idx="${idx}" value="${v(s.miR)}" placeholder="0.7"></div>
          </div>
          <div class="hint">Se você preencher os furos de equalização (seção própria) e as folgas (zj, δ, Δ, folga disco-diafragma), o coeficiente k passa a ser calculado de verdade a partir deles (mesma fórmula e mesmas cartas MiDes/Coef Vedação da planilha original) — "Coef. de pressão no disco k" acima vira só um substituto usado quando essa geometria não está completa. O único elo que ainda falta fechar nessa fórmula é μr (carta MiR, função de Reynolds) — por isso ele é um valor ajustável (padrão 0,7) em vez de calculado. Ver ARCHITECTURE.md.</div>
        </details>
      </div>
    `; }).join('');

    wrap.querySelectorAll('[data-remove]').forEach(btn => {
      btn.onclick = () => { readForm(false); state.stages.splice(parseInt(btn.dataset.remove), 1); renderStageCards(); };
    });
    // Campos que alimentam valores calculados exibidos no próprio card (passo
    // do diafragma, β2e) — recalcula e redesenha o card ao mudar.
    wrap.querySelectorAll('.s-recalc').forEach(inp => {
      inp.addEventListener('change', () => { readForm(false); renderStageCards(); });
    });
  }

  function readForm(readTop = true) {
    if (readTop) {
      state.tipo = document.getElementById('f-tipo').value;
      state.os = document.getElementById('f-os').value;
      state.cliente = document.getElementById('f-cliente').value;
      state.n_rpm = num(document.getElementById('f-n').value);
      state.mdot_kgh = num(document.getElementById('f-mdot').value);
      state.P_adm_bar = num(document.getElementById('f-padm').value);
      state.T_adm_degC = num(document.getElementById('f-tadm').value);
      state.P_exh_bar = num(document.getElementById('f-pexh').value);
      state.valveLossPct = num(document.getElementById('f-valveloss').value);
      state.gearboxEffPct = num(document.getElementById('f-geff').value);
      state.generatorEffPct = num(document.getElementById('f-generatoreff').value);
      state.kGas = num(document.getElementById('f-kgas').value);
      state.tolConsumoPct = num(document.getElementById('f-tolconsumo').value);
      state.flangeAdmIn = num(document.getElementById('f-flangeadm').value);
      state.flangeExhIn = num(document.getElementById('f-flangeexh').value);
      state.controlWheelType = document.getElementById('f-controlwheel').value;
      state.injectionGroups = num(document.getElementById('f-injectiongroups').value);
      state.thrustPadDe = num(document.getElementById('f-thrustde').value);
      state.thrustPadDi = num(document.getElementById('f-thrustdi').value);
      state.thrustPadAlpha = num(document.getElementById('f-thrustalpha').value);
      state.thrustPadAreaOverride = num(document.getElementById('f-thrustareaoverride').value);
    }
    document.querySelectorAll('.s-field[data-grp]').forEach(inp => {
      const idx = parseInt(inp.dataset.idx), grp = inp.dataset.grp, k = inp.dataset.k;
      const isTextual = inp.tagName === 'SELECT' || (inp.tagName === 'INPUT' && inp.type === 'text');
      state.stages[idx][grp][k] = isTextual ? inp.value : num(inp.value);
    });
    document.querySelectorAll('.s-top[data-k]').forEach(inp => {
      const idx = parseInt(inp.dataset.idx), k = inp.dataset.k;
      state.stages[idx][k] = inp.type === 'checkbox' ? inp.checked : num(inp.value);
    });
    document.querySelectorAll('.ak-field[data-k]').forEach(inp => {
      const idx = parseInt(inp.dataset.idx), k = inp.dataset.k;
      state.akDevices[idx][k] = (k === 'akStage') ? inp.value : num(inp.value);
    });
  }

  function validateState() {
    const missing = [];
    const req = [['n_rpm', 'Rotação'], ['mdot_kgh', 'Vazão'], ['P_adm_bar', 'Pressão admissão'], ['T_adm_degC', 'Temperatura admissão'], ['P_exh_bar', 'Pressão de escape']];
    req.forEach(([k, label]) => { if (isNaN(state[k])) missing.push(label); });
    state.stages.forEach((s, idx) => {
      ['dm', 'l', 'z', 'e'].forEach(k => { if (isNaN(s.nozzle[k])) missing.push(`Estágio ${idx + 1} — bocal ${k}`); });
      ['dm', 'l', 'z', 'e'].forEach(k => { if (isNaN(s.rotor[k])) missing.push(`Estágio ${idx + 1} — rotor ${k}`); });
    });
    return missing;
  }

  // ---------------- Cálculo ----------------
  function recalc() {
    const notices = document.getElementById('notices');
    notices.innerHTML = '';
    const missing = validateState();
    if (missing.length) {
      notices.innerHTML = `<div class="notice error"><strong>Preencha os campos antes de calcular:</strong> ${missing.join(', ')}.</div>`;
      renderEmptyState();
      return;
    }
    const params = {
      n_rpm: state.n_rpm, P_adm_bar: state.P_adm_bar, T_adm_degC: state.T_adm_degC, P_exh_bar: state.P_exh_bar,
      mdot_kgh: state.mdot_kgh, gearboxEff: state.gearboxEffPct / 100, generatorEff: state.generatorEffPct / 100,
      valveLossPct: state.valveLossPct, kGas: state.kGas, tolConsumoPct: state.tolConsumoPct,
      controlWheelType: state.controlWheelType,
      thrustPad: (state.thrustPadDe > 0 && state.thrustPadDi > 0) || state.thrustPadAreaOverride > 0 ? {
        De: num(state.thrustPadDe) || 0, Di: num(state.thrustPadDi) || 0,
        alpha: isNaN(num(state.thrustPadAlpha)) ? 0.9 : num(state.thrustPadAlpha),
        areaOverride: num(state.thrustPadAreaOverride) || 0
      } : null,
      akDevices: state.akDevices.filter(ak => ak.dak > 0).map(ak => ({ dak: num(ak.dak), akStage: ak.akStage })),
      stages: state.stages.map(s => ({
        nozzle: { dm: s.nozzle.dm, l: s.nozzle.l, z: s.nozzle.z, e: s.nozzle.e, zeta: s.nozzle.zetaPct / 100 },
        rotor: { dm: s.rotor.dm, l: s.rotor.l, z: s.rotor.z, e: s.rotor.e, zeta: s.rotor.zetaPct / 100 },
        discardExitKE: !!s.discardExitKE,
        extractionKgh: isNaN(num(s.extractionKgh)) ? 0 : num(s.extractionKgh),
        sectorLossPct: isNaN(num(s.sectorLossPct)) ? 0 : num(s.sectorLossPct),
        kFriction: isNaN(num(s.kFriction)) ? 1.1 : num(s.kFriction),
        kThrust: isNaN(num(s.kThrust)) ? 0.95 : num(s.kThrust),
        miR: isNaN(num(s.miR)) ? undefined : num(s.miR),
        seals: (s.seals && (s.seals.zj > 0 || s.seals.delta > 0 || s.seals.deltaDiscDiaphragm > 0)) ? {
          zj: num(s.seals.zj) || 0, delta: num(s.seals.delta) || 0, sealDiam: num(s.seals.sealDiam) || 0,
          psi: isNaN(num(s.seals.psi)) ? 0.75 : num(s.seals.psi),
          deltaDiscDiaphragm: num(s.seals.deltaDiscDiaphragm) || 0, bigDelta: num(s.seals.bigDelta) || 0
        } : null,
        eqHoles: (s.eqHoles && s.eqHoles.diameter > 0 && s.eqHoles.qty > 0 && s.eqHoles.pitchDiameter > 0) ? {
          diameter: num(s.eqHoles.diameter), qty: num(s.eqHoles.qty), pitchDiameter: num(s.eqHoles.pitchDiameter)
        } : null,
        diaphragm: (s.diaphragm && (s.diaphragm.d2n > 0 || s.diaphragm.d1n > 0)) ? {
          d1n: num(s.diaphragm.d1n) || 0, d2n: num(s.diaphragm.d2n) || 0
        } : null
      }))
    };
    try {
      result = Engine.run(params);
    } catch (e) {
      notices.innerHTML = `<div class="notice error"><strong>Erro no cálculo:</strong> ${e.message}. Confira a geometria e as condições operacionais.</div>`;
      console.error(e);
      return;
    }
    document.getElementById('hdr-tipo').textContent = state.tipo || '—';
    document.getElementById('hdr-os').textContent = state.os || '—';
    document.getElementById('hdr-cliente').textContent = state.cliente || '—';

    if (result.warnings.length) {
      notices.innerHTML = `<div class="notice error"><strong>Avisos:</strong> ${result.warnings.join(' · ')}</div>`;
    }

    triStageIdx = 0;
    renderResumo();
    renderSteampathTab();
    renderTriangulos();
    renderMollier();
    renderPerdas();
    renderEmpuxo();
    renderTabela();
  }

  // ---------------- Resumo ----------------
  function renderResumo() {
    const r = result, s = r.summary;
    const el = document.getElementById('panel-resumo');
    el.innerHTML = `
      <div class="card-grid">
        <div class="stat-card"><div class="label">Potência no eixo</div><div class="value">${fmt(s.powerShaft, 0)}<span class="unit">kW</span></div></div>
        <div class="stat-card"><div class="label">Potência interna</div><div class="value">${fmt(s.powerInternal, 0)}<span class="unit">kW</span></div></div>
        <div class="stat-card"><div class="label">Eficiência interna</div><div class="value">${fmt(s.etaInternal * 100, 1)}<span class="unit">%</span></div></div>
        <div class="stat-card"><div class="label">Eficiência total</div><div class="value">${fmt(s.etaOverall * 100, 1)}<span class="unit">%</span></div></div>
        <div class="stat-card"><div class="label">Consumo específico</div><div class="value">${fmt(s.specificConsumption, 2)}<span class="unit">kg/kWh</span></div></div>
        <div class="stat-card"><div class="label">Perda de válvula convergida</div><div class="value">${fmt(r.valveLossPct, 2)}<span class="unit">%</span></div></div>
        <div class="stat-card"><div class="label">Vazão</div><div class="value">${fmt(s.mdot_kgh, 0)}<span class="unit">kg/h</span></div></div>
        <div class="stat-card"><div class="label">Empuxo axial total</div><div class="value">${fmt(s.axialThrustTotal / 1000, 2)}<span class="unit">kN</span></div></div>
      </div>
      <div class="chart-box">
        <h3>Verificação da convergência</h3>
        <p class="desc">Pressão final da marcha estágio-a-estágio comparada à pressão de escape informada — devem coincidir quando o laço de convergência fecha.</p>
        <div class="card-grid" style="margin-bottom:0;">
          <div class="stat-card"><div class="label">Pressão final calculada</div><div class="value">${fmt(s.pFinalComputed, 3)}<span class="unit">bar</span></div></div>
          <div class="stat-card"><div class="label">Pressão de escape alvo</div><div class="value">${fmt(s.pExhTarget, 3)}<span class="unit">bar</span></div></div>
        </div>
      </div>
      <div class="chart-box">
        <h3>Resumo por estágio</h3>
        <div class="table-scroll" style="max-height:260px;">
          <table>
            <thead><tr><th>Estágio</th><th>P0 (bar)</th><th>P1 (bar)</th><th>P2 (bar)</th><th>u (m/s)</th><th>c1 (m/s)</th><th>Pot. líq. (kW)</th><th>η estágio (%)</th></tr></thead>
            <tbody>${r.stages.map((st, i) => `<tr><td>${i + 1}</td><td>${fmt(st.p0,2)}</td><td>${fmt(st.p1,2)}</td><td>${fmt(st.p2,2)}</td><td>${fmt(st.u,1)}</td><td>${fmt(st.c1,1)}</td><td>${fmt(st.powerNet,1)}</td><td>${fmt(st.etaStage*100,1)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ---------------- Steampath visual (destaque) ----------------
  function pressureColor(t) {
    // t=1 (alta pressão) -> brass; t=0 (baixa pressão) -> azul
    const c1 = [16, 182, 182], c2 = [91, 141, 184];
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * (1 - t));
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * (1 - t));
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * (1 - t));
    return `rgb(${r},${g},${b})`;
  }

  function renderSteampathTab() {
    const r = result;
    const el = document.getElementById('panel-steampath');
    const N = r.stages.length;
    const pMax = r.admState.p, pMin = r.summary.pExhTarget;
    const logRange = Math.log(pMax) - Math.log(pMin) || 1;

    // geometria: eixo x = posição axial acumulada; eixo y = raio (mm)
    const segW = 70, gap = 14, padL = 70, padTop = 20, padBot = 40;
    let x = padL;
    const blocks = [];
    let rMax = 0;
    state.stages.forEach((s, i) => {
      const st = r.stages[i];
      const rn1 = s.nozzle.dm / 2 - s.nozzle.l / 2, rn2 = s.nozzle.dm / 2 + s.nozzle.l / 2;
      const rr1 = s.rotor.dm / 2 - s.rotor.l / 2, rr2 = s.rotor.dm / 2 + s.rotor.l / 2;
      rMax = Math.max(rMax, rn2, rr2);
      const tNoz = clamp01((Math.log(st.p0) - Math.log(pMin)) / logRange);
      const tRot = clamp01((Math.log(st.p1) - Math.log(pMin)) / logRange);
      blocks.push({ x1: x, x2: x + segW, r1: rn1, r2: rn2, color: pressureColor(tNoz), label: 'Bocal ' + (i + 1), p: st.p0 });
      x += segW + 6;
      blocks.push({ x1: x, x2: x + segW, r1: rr1, r2: rr2, color: pressureColor(tRot), label: 'Rotor ' + (i + 1), p: st.p1 });
      x += segW + gap;
    });
    const W = x + padL, H = rMax * 2 + padTop + padBot + 40;
    const cy = padTop + 20 + rMax;
    const svgBlocks = blocks.map(b => {
      const y1 = cy - b.r2, y1b = cy - b.r1, y2 = cy + b.r1, y2b = cy + b.r2;
      const h1 = y1b - y1, h2 = y2b - y2;
      return `
        <rect x="${b.x1}" y="${y1}" width="${b.x2 - b.x1}" height="${h1}" fill="${b.color}" opacity="0.85" stroke="var(--line)" stroke-width="1"/>
        <rect x="${b.x1}" y="${y2}" width="${b.x2 - b.x1}" height="${h2}" fill="${b.color}" opacity="0.85" stroke="var(--line)" stroke-width="1"/>
        <text x="${(b.x1 + b.x2) / 2}" y="${cy + rMax + 26}" text-anchor="middle" font-size="9.5" fill="var(--ink-faint)" font-family="IBM Plex Mono, monospace">${b.label}</text>
        <text x="${(b.x1 + b.x2) / 2}" y="${cy + rMax + 38}" text-anchor="middle" font-size="9.5" fill="var(--ink-dim)" font-family="IBM Plex Mono, monospace">${b.p.toFixed(2)} bar</text>
      `;
    }).join('');
    const axisLine = `<line x1="${padL - 10}" y1="${cy}" x2="${x}" y2="${cy}" stroke="var(--line)" stroke-dasharray="3,3"/>
      <text x="${padL - 16}" y="${cy + 4}" text-anchor="end" font-size="10" fill="var(--ink-faint)" font-family="IBM Plex Mono, monospace">eixo</text>`;

    el.innerHTML = `
      <div class="chart-box">
        <h3>Steampath — corte meridional (linha média)</h3>
        <p class="desc">Bocais fixos e palhetas móveis desenhados em escala pelo diâmetro médio e pela altura de pá; a cor indica o nível de pressão (mais quente = mais alta pressão). Vista simplificada de uma única linha média — a próxima evolução adiciona raiz/média/topo.</p>
        <div class="svg-wrap">
          <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="IBM Plex Sans, sans-serif">
            ${axisLine}
            ${svgBlocks}
          </svg>
        </div>
        <div class="legend-row">
          <span><span class="swatch" style="background:${pressureColor(1)}"></span> alta pressão</span>
          <span><span class="swatch" style="background:${pressureColor(0)}"></span> baixa pressão</span>
        </div>
      </div>
      <div class="chart-box">
        <h3>Diâmetro médio e altura de pá por estágio</h3>
        <div class="chart-wrap"><canvas id="chart-geom"></canvas></div>
      </div>
    `;
    destroy('geom');
    const labels = state.stages.map((s, i) => 'Estágio ' + (i + 1));
    charts.geom = new Chart(document.getElementById('chart-geom'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Ø médio bocal (mm)', data: state.stages.map(s => s.nozzle.dm), backgroundColor: CHART_COLORS[0] + '99' },
          { label: 'Ø médio rotor (mm)', data: state.stages.map(s => s.rotor.dm), backgroundColor: CHART_COLORS[1] + '99' },
          { label: 'Altura pá bocal (mm)', data: state.stages.map(s => s.nozzle.l), backgroundColor: CHART_COLORS[2] + '99', yAxisID: 'y1' },
          { label: 'Altura pá rotor (mm)', data: state.stages.map(s => s.rotor.l), backgroundColor: CHART_COLORS[3] + '99', yAxisID: 'y1' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { labels: { color: TICK, boxWidth: 12 } } },
        scales: {
          x: { grid: { color: GRID }, ticks: { color: TICK } },
          y: { position: 'left', title: { display: true, text: 'Ø médio (mm)', color: TICK }, grid: { color: GRID }, ticks: { color: TICK } },
          y1: { position: 'right', title: { display: true, text: 'Altura de pá (mm)', color: TICK }, grid: { display: false }, ticks: { color: TICK } }
        }
      }
    });
  }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  // ---------------- Triângulos de velocidade ----------------
  function renderTriangulos() {
    const r = result;
    const el = document.getElementById('panel-triangulos');
    const N = r.stages.length;
    el.innerHTML = `
      <div class="chart-box">
        <h3>Triângulo de velocidades</h3>
        <p class="desc">c — velocidade absoluta · u — velocidade periférica da pá · w — velocidade relativa. Ângulos medidos a partir da direção tangencial (convenção da metodologia original).</p>
        <div class="stage-pick-row" id="tri-picker"></div>
        <div class="svg-wrap" id="tri-svg"></div>
        <div class="legend-row">
          <span><span class="swatch" style="background:${CHART_COLORS[0]}"></span> c1 (entrada, absoluta)</span>
          <span><span class="swatch" style="background:${CHART_COLORS[1]}"></span> u (periférica)</span>
          <span><span class="swatch" style="background:${CHART_COLORS[2]}"></span> w1 (entrada, relativa)</span>
          <span><span class="swatch" style="background:${CHART_COLORS[3]}"></span> w2 (saída, relativa)</span>
          <span><span class="swatch" style="background:${CHART_COLORS[4]}"></span> c2 (saída, absoluta)</span>
        </div>
      </div>
      <div class="chart-box">
        <h3>Ângulos e velocidades por estágio</h3>
        <div class="chart-wrap"><canvas id="chart-tri"></canvas></div>
      </div>
    `;
    const picker = document.getElementById('tri-picker');
    picker.innerHTML = r.stages.map((s, i) => `<button class="stage-pick ${i === triStageIdx ? 'active' : ''}" data-i="${i}">Estágio ${i + 1}</button>`).join('');
    picker.querySelectorAll('button').forEach(b => b.onclick = () => { triStageIdx = parseInt(b.dataset.i); renderTriangulos(); });
    drawTriangle(r.stages[triStageIdx]);

    destroy('tri');
    charts.tri = new Chart(document.getElementById('chart-tri'), {
      type: 'bar',
      data: {
        labels: r.stages.map((s, i) => 'Estágio ' + (i + 1)),
        datasets: [
          { label: 'c1 (m/s)', data: r.stages.map(s => s.c1), backgroundColor: CHART_COLORS[0] + '99' },
          { label: 'w1 (m/s)', data: r.stages.map(s => s.w1), backgroundColor: CHART_COLORS[2] + '99' },
          { label: 'w2 (m/s)', data: r.stages.map(s => s.w2), backgroundColor: CHART_COLORS[3] + '99' },
          { label: 'c2 (m/s)', data: r.stages.map(s => s.c2), backgroundColor: CHART_COLORS[4] + '99' }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { labels: { color: TICK, boxWidth: 12 } } },
        scales: { x: { grid: { color: GRID }, ticks: { color: TICK } }, y: { title: { display: true, text: 'Velocidade (m/s)', color: TICK }, grid: { color: GRID }, ticks: { color: TICK } } }
      }
    });
  }

  function drawTriangle(s) {
    const box = document.getElementById('tri-svg');
    const W = 520, H = 340, ox = 90, oy = 260;
    const scale = 0.32 * Math.min(1, 300 / Math.max(s.c1, s.w2, s.c2, s.u, 50));
    // Convenção: eixo x = tangencial (direção de u), eixo y = axial (para cima no desenho)
    function pt(u_, a_) { return [ox + u_ * scale, oy - a_ * scale]; }
    const O = [ox, oy];
    const Utip = pt(s.u, 0);
    const C1 = pt(s.cu1, s.ca1);
    const W1 = pt(s.wu1, s.wa1);
    // saída: desenhada a partir da ponta de u (triângulo de saída compartilha o vértice de u)
    const baseOut = Utip;
    const C2 = [baseOut[0] + s.cu2 * scale, baseOut[1] - s.ca2 * scale];
    const W2 = [baseOut[0] + (s.cu2 - (-s.u)) * scale, baseOut[1] - s.ca2 * scale]; // w2 tangencial = c2u + u

    function arrow(id, p1, p2, color) {
      return `<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="${color}" stroke-width="2.4" marker-end="url(#${id})"/>`;
    }
    const defs = `<defs>
      ${CHART_COLORS.slice(0,5).map((c,i)=>`<marker id="ah${i}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${c}"/></marker>`).join('')}
    </defs>`;
    const w2u_tangential = s.wu1 === undefined ? 0 : 0;
    // recompute w2 endpoint corretamente a partir dos componentes reais (cu2,ca2 já derivam de w2)
    const W2b = [baseOut[0] + (s.cu2 + s.u) * scale, baseOut[1] - s.ca2 * scale];

    box.innerHTML = `
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        ${defs}
        <line x1="20" y1="${oy}" x2="${W-20}" y2="${oy}" stroke="var(--line)" stroke-dasharray="2,3"/>
        ${arrow('ah1', O, Utip, CHART_COLORS[1])}
        ${arrow('ah0', O, C1, CHART_COLORS[0])}
        ${arrow('ah2', Utip, C1, CHART_COLORS[2])}
        ${arrow('ah4', Utip, C2, CHART_COLORS[4])}
        ${arrow('ah3', Utip, W2b, CHART_COLORS[3])}
        <circle cx="${O[0]}" cy="${O[1]}" r="2.5" fill="var(--ink-dim)"/>
        <text x="${O[0]-8}" y="${O[1]+16}" font-size="10" fill="var(--ink-faint)" font-family="IBM Plex Mono, monospace">0</text>
        <text x="${Utip[0]+4}" y="${Utip[1]-4}" font-size="10.5" fill="${CHART_COLORS[1]}" font-family="IBM Plex Mono, monospace">u=${s.u.toFixed(0)}</text>
        <text x="${C1[0]+4}" y="${C1[1]}" font-size="10.5" fill="${CHART_COLORS[0]}" font-family="IBM Plex Mono, monospace">c1=${s.c1.toFixed(0)} (α1=${s.alpha1.toFixed(1)}°)</text>
        <text x="${C2[0]+4}" y="${C2[1]}" font-size="10.5" fill="${CHART_COLORS[4]}" font-family="IBM Plex Mono, monospace">c2=${s.c2.toFixed(0)} (α2=${s.alpha2.toFixed(1)}°)</text>
        <text x="${W2b[0]+4}" y="${W2b[1]+12}" font-size="10.5" fill="${CHART_COLORS[3]}" font-family="IBM Plex Mono, monospace">w2=${s.w2.toFixed(0)} (β2=${s.beta2.toFixed(1)}°)</text>
      </svg>
    `;
  }

  // ---------------- Pressões & Mollier ----------------
  function renderMollier() {
    const r = result;
    const el = document.getElementById('panel-mollier');
    el.innerHTML = `
      <div class="chart-box">
        <h3>Distribuição de pressão ao longo da linha de expansão</h3>
        <p class="desc">Pressão estática na saída do bocal (P1) e na saída do rotor (P2) de cada estágio.</p>
        <div class="chart-wrap tall"><canvas id="chart-press"></canvas></div>
      </div>
      <div class="chart-box">
        <h3>Diagrama entalpia × entropia (linha de expansão real)</h3>
        <p class="desc">Pontos reais (0→1→2 por estágio) sobre o plano h–s — mostra o reaquecimento por perdas em cada bocal/rotor.</p>
        <div class="chart-wrap tall"><canvas id="chart-hs"></canvas></div>
      </div>
    `;
    const labels = ['Admissão', ...r.stages.map((s, i) => 'Estágio ' + (i + 1))];
    destroy('press');
    charts.press = new Chart(document.getElementById('chart-press'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'P0 (entrada do estágio)', data: [r.admState.p, ...r.stages.map(s => s.p0)], borderColor: CHART_COLORS[0], borderWidth: 2, pointRadius: 3, tension: 0 },
          { label: 'P1 (saída do bocal)', data: [null, ...r.stages.map(s => s.p1)], borderColor: CHART_COLORS[1], borderWidth: 2, pointRadius: 3, tension: 0 },
          { label: 'P2 (saída do rotor)', data: [null, ...r.stages.map(s => s.p2)], borderColor: CHART_COLORS[2], borderWidth: 2, pointRadius: 3, tension: 0 }
        ]
      },
      options: baseLineOpts('', 'Pressão (bar)')
    });
    destroy('hs');
    const pts = [{ x: r.admState.s, y: r.admState.h }];
    r.stages.forEach(s => { pts.push({ x: s.s0, y: s.h0 }); pts.push({ x: s.s1, y: s.h1 }); pts.push({ x: s.s2, y: s.h2 }); });
    charts.hs = new Chart(document.getElementById('chart-hs'), {
      type: 'line',
      data: { datasets: [{ label: 'Linha de expansão real', data: pts, borderColor: CHART_COLORS[0], backgroundColor: CHART_COLORS[0], borderWidth: 2, pointRadius: 2.5, tension: 0, showLine: true }] },
      options: { ...baseLineOpts('Entropia s (kJ/kg·K)', 'Entalpia h (kJ/kg)'), parsing: false, scales: { x: { type: 'linear', title: { display: true, text: 'Entropia s (kJ/kg·K)', color: TICK }, grid: { color: GRID }, ticks: { color: TICK } }, y: { title: { display: true, text: 'Entalpia h (kJ/kg)', color: TICK }, grid: { color: GRID }, ticks: { color: TICK } } } }
    });
  }

  // ---------------- Perdas ----------------
  function renderPerdas() {
    const r = result;
    const el = document.getElementById('panel-perdas');
    el.innerHTML = `
      <div class="chart-box">
        <h3>Atrito de disco e ventilação por estágio</h3>
        <div class="chart-wrap"><canvas id="chart-fric"></canvas></div>
      </div>
      <div class="chart-box">
        <h3>Vazão de vazamento (labirinto) por estágio</h3>
        <div class="chart-wrap"><canvas id="chart-leak"></canvas></div>
      </div>
      <div class="chart-box">
        <h3>Perda de energia cinética de saída</h3>
        <p class="desc">Só é uma perda líquida quando não aproveitada pelo próximo estágio (opção "descartar" marcada) — no último estágio, é sempre perda para o condensador/escape.</p>
        <div class="chart-wrap"><canvas id="chart-kel"></canvas></div>
      </div>
    `;
    const labels = r.stages.map((s, i) => 'Estágio ' + (i + 1));
    destroy('fric');
    charts.fric = new Chart(document.getElementById('chart-fric'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Atrito + ventilação (kW)', data: r.stages.map(s => s.P_friction), backgroundColor: CHART_COLORS[4] + '99' }] },
      options: baseLineOpts('', 'kW')
    });
    destroy('leak');
    charts.leak = new Chart(document.getElementById('chart-leak'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Vazão de vazamento (kg/s)', data: r.stages.map(s => s.mdot_leak), backgroundColor: CHART_COLORS[5] + '99' }] },
      options: baseLineOpts('', 'kg/s')
    });
    destroy('kel');
    charts.kel = new Chart(document.getElementById('chart-kel'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Energia cinética de saída (kJ/kg)', data: r.stages.map(s => s.exitKELoss), backgroundColor: CHART_COLORS[3] + '99' }] },
      options: baseLineOpts('', 'kJ/kg')
    });
  }

  // ---------------- Empuxo axial ----------------
  function renderEmpuxo() {
    const r = result;
    const el = document.getElementById('panel-empuxo');
    const s = r.summary;
    el.innerHTML = `
      <div class="card-grid">
        <div class="stat-card"><div class="label">Empuxo axial resultante</div><div class="value">${fmt(s.axialThrustTotal, 0)}<span class="unit">N</span></div></div>
        <div class="stat-card"><div class="label">Pressão específica no mancal</div><div class="value">${s.axialSpecificPressureMPa != null ? fmt(s.axialSpecificPressureMPa, 3) : '—'}<span class="unit">MPa</span></div></div>
        <div class="stat-card"><div class="label">Empuxo a favor (ΣRaI+RaIII+Fant+)</div><div class="value">${fmt(r.axialByStage.reduce((a, x) => a + x.F_total, 0) + s.F_antFavor, 0)}<span class="unit">N</span></div></div>
        <div class="stat-card"><div class="label">Empuxo contra (ΣFak-)</div><div class="value">${fmt(s.sumFakContra, 0)}<span class="unit">N</span></div></div>
      </div>
      <div class="chart-box">
        <h3>Empuxo por estágio (RaI + RaIII)</h3>
        <p class="desc">RaI = força de momento (ṁ·(ca1−ca2)) + força de pressão no disco (Δp do rotor, corrigida pelo coeficiente k, sobre π·dm2·l2). RaIII = pressão de entrada do estágio sobre a face anular do eixo entre d1n e d2n (zero se d1n=d2n ou não informados). Metodologia igual à planilha original (Output, linhas 200–238).</p>
        <div class="chart-wrap tall"><canvas id="chart-axial"></canvas></div>
      </div>
      ${s.sumFakContra > 0 || s.F_antFavor > 0 ? `
      <div class="chart-box">
        <h3>Pistão(ões) de compensação (AK)</h3>
        <p class="desc">Cada diafragma com Ø de compensação (dak) informado é um degrau da mesma cadeia — a face de cada degrau é pressurizada pela pressão de admissão do estágio referenciado (contra o empuxo); a face traseira do último degrau é pressurizada pela pressão de escape (a favor do empuxo).</p>
        <div class="card-grid" style="margin-bottom:0;">
          <div class="stat-card"><div class="label">Contra (Fak-)</div><div class="value">${fmt(s.sumFakContra, 0)}<span class="unit">N</span></div></div>
          <div class="stat-card"><div class="label">A favor (Fant+)</div><div class="value">${fmt(s.F_antFavor, 0)}<span class="unit">N</span></div></div>
        </div>
      </div>` : ''}
    `;
    const labels = r.stages.map((s, i) => 'Estágio ' + (i + 1));
    destroy('axial');
    charts.axial = new Chart(document.getElementById('chart-axial'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'RaI — momento (N)', data: r.axialByStage.map(a => a.F_momentum), backgroundColor: CHART_COLORS[0] + '99' },
          { label: 'RaI — pressão no disco (N)', data: r.axialByStage.map(a => a.F_pressure), backgroundColor: CHART_COLORS[1] + '99' },
          { label: 'RaIII — pressão face do eixo (N)', data: r.axialByStage.map(a => a.F_RaIII), backgroundColor: CHART_COLORS[2] + '99' }
        ]
      },
      options: { ...baseLineOpts('', 'N'), scales: { x: { grid: { color: GRID }, ticks: { color: TICK }, stacked: true }, y: { grid: { color: GRID }, ticks: { color: TICK }, stacked: true } } }
    });
  }

  // ---------------- Tabela ----------------
  function renderTabela() {
    const r = result;
    const el = document.getElementById('panel-tabela');
    const rows = r.stages.map((s, i) => `
      <tr>
        <td>${i + 1}</td><td>${fmt(s.p0,3)}</td><td>${fmt(s.p1,3)}</td><td>${fmt(s.p2,3)}</td>
        <td>${fmt(s.h0,1)}</td><td>${fmt(s.h1,1)}</td><td>${fmt(s.h2,1)}</td>
        <td>${fmt(s.u,1)}</td><td>${fmt(s.c1,1)}</td><td>${fmt(s.w1,1)}</td><td>${fmt(s.w2,1)}</td><td>${fmt(s.c2,1)}</td>
        <td>${fmt(s.alpha1,1)}</td><td>${fmt(s.beta1,1)}</td>
        <td>${fmt(s.dh_u,2)}</td><td>${fmt(s.powerNet,1)}</td><td>${fmt(s.etaStage*100,1)}</td>
      </tr>`).join('');
    el.innerHTML = `
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th>Estágio</th><th>P0 (bar)</th><th>P1 (bar)</th><th>P2 (bar)</th>
            <th>h0 (kJ/kg)</th><th>h1 (kJ/kg)</th><th>h2 (kJ/kg)</th>
            <th>u (m/s)</th><th>c1 (m/s)</th><th>w1 (m/s)</th><th>w2 (m/s)</th><th>c2 (m/s)</th>
            <th>α1 (°)</th><th>β1 (°)</th>
            <th>Δh_u (kJ/kg)</th><th>Pot. líq. (kW)</th><th>η (%)</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function toCSV() {
    const r = result;
    let csv = 'estagio,P0_bar,P1_bar,P2_bar,h0_kJkg,h1_kJkg,h2_kJkg,u_ms,c1_ms,w1_ms,w2_ms,c2_ms,alfa1_deg,beta1_deg,dh_u_kJkg,potencia_liquida_kW,eta_estagio_pct\n';
    r.stages.forEach((s, i) => {
      csv += [i + 1, s.p0.toFixed(3), s.p1.toFixed(3), s.p2.toFixed(3), s.h0.toFixed(2), s.h1.toFixed(2), s.h2.toFixed(2), s.u.toFixed(1), s.c1.toFixed(1), s.w1.toFixed(1), s.w2.toFixed(1), s.c2.toFixed(1), s.alpha1.toFixed(2), s.beta1.toFixed(2), s.dh_u.toFixed(3), s.powerNet.toFixed(1), (s.etaStage * 100).toFixed(2)].join(',') + '\n';
    });
    return csv;
  }

  // ---------------- Helpers ----------------
  function fmt(x, d) { return (x === undefined || x === null || isNaN(x)) ? '—' : Number(x).toFixed(d); }
  function destroy(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }
  function baseLineOpts(xTitle, yTitle) {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: TICK, boxWidth: 12, font: { family: "'IBM Plex Sans', sans-serif", size: 11 } } }, tooltip: { backgroundColor: '#1F2530', borderColor: '#2B3340', borderWidth: 1, titleColor: '#E8E6E0', bodyColor: '#9AA4B2' } },
      scales: {
        x: { title: { display: !!xTitle, text: xTitle || '', color: TICK }, grid: { color: GRID }, ticks: { color: TICK, maxTicksLimit: 12 } },
        y: { title: { display: !!yTitle, text: yTitle || '', color: TICK }, grid: { color: GRID }, ticks: { color: TICK } }
      }
    };
  }

  // ---------------- Tabs ----------------
  function wireTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
      };
    });
  }

  // ---------------- Estado vazio ----------------
  function renderEmptyState() {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-resumo').classList.add('active');
    document.getElementById('panel-resumo').innerHTML = `
      <div class="notice" style="text-align:center;padding:40px 20px;">
        Preencha os dados na lateral e clique em <strong>Calcular linha de expansão</strong> — ou abra um projeto salvo com <strong>Abrir…</strong> no topo.
      </div>`;
    for (const id of ['steampath', 'triangulos', 'mollier', 'perdas', 'empuxo', 'tabela']) {
      document.getElementById('panel-' + id).innerHTML = '';
    }
  }

  // ==========================================================================
  // PROJETOS — salvar / abrir / salvar como
  // ==========================================================================
  const APP_ID = 'steampath';
  let currentProjectPath = null;

  function buildProjectData(name) {
    return {
      appId: APP_ID, version: 1,
      name: name || (currentProjectPath ? currentProjectPath.split('/').pop().replace(/\.json$/i, '') : 'projeto'),
      savedAt: new Date().toISOString(), state
    };
  }
  function applyProjectData(data) {
    if (!data || !data.state) { alert('Arquivo de projeto inválido.'); return; }
    if (data.appId && data.appId !== APP_ID) {
      if (!confirm(`Este arquivo foi salvo pelo app "${data.appId}", não pelo STEAMPATH. Tentar carregar mesmo assim?`)) return;
    }
    state = data.state;
    renderSidebar();
    recalc();
  }
  function updateProjectDisplay() {
    const disp = document.getElementById('project-path-display');
    disp.value = currentProjectPath ? currentProjectPath : '(projeto não salvo)';
  }

  let fbMode = 'open', fbCurrentDir = '', fbSelected = null;

  async function fbList(dir) {
    const res = await fetch('/api/browse?path=' + encodeURIComponent(dir));
    if (!res.ok) { document.getElementById('fb-msg').textContent = 'Erro ao listar pasta.'; return; }
    const data = await res.json();
    fbCurrentDir = data.path;
    fbSelected = null;
    renderBreadcrumb();
    const list = document.getElementById('fb-list');
    if (!data.entries.length) {
      list.innerHTML = '<div class="modal-row" style="color:var(--ink-faint);cursor:default;">— pasta vazia —</div>';
      return;
    }
    list.innerHTML = data.entries.map(e => `
      <div class="modal-row ${e.isDir ? 'dir' : ''}" data-name="${e.name}" data-isdir="${e.isDir}">
        <span class="ic">${e.isDir ? '\u{1F4C1}' : '\u{1F4C4}'}</span><span>${e.name}</span>
      </div>`).join('');
    list.querySelectorAll('.modal-row[data-name]').forEach(row => {
      row.onclick = () => {
        const name = row.dataset.name, isDir = row.dataset.isdir === 'true';
        if (isDir) { fbList(fbCurrentDir ? fbCurrentDir + '/' + name : name); }
        else {
          list.querySelectorAll('.modal-row').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          fbSelected = { name, isDir };
          if (fbMode === 'save') document.getElementById('fb-filename').value = name;
        }
      };
    });
  }
  function renderBreadcrumb() {
    const bc = document.getElementById('fb-breadcrumb');
    const parts = fbCurrentDir ? fbCurrentDir.split('/').filter(Boolean) : [];
    let html = `<button data-path="">raiz</button>`;
    let acc = '';
    parts.forEach(p => { acc = acc ? acc + '/' + p : p; html += ` / <button data-path="${acc}">${p}</button>`; });
    bc.innerHTML = html;
    bc.querySelectorAll('button').forEach(b => { b.onclick = () => fbList(b.dataset.path); });
  }
  function openFileBrowser(mode) {
    fbMode = mode;
    document.getElementById('fb-title').textContent = mode === 'open' ? 'Abrir projeto' : 'Salvar projeto como';
    document.getElementById('fb-msg').textContent = '';
    document.getElementById('fb-filename').style.display = mode === 'save' ? '' : 'none';
    document.getElementById('fb-filename').value = currentProjectPath ? currentProjectPath.split('/').pop() : (state.tipo ? state.tipo.replace(/[^a-zA-Z0-9_-]+/g, '_') + '.json' : 'projeto.json');
    document.getElementById('fb-confirm').textContent = mode === 'open' ? 'Abrir' : 'Salvar aqui';
    document.getElementById('fb-overlay').classList.add('open');
    const startDir = currentProjectPath && currentProjectPath.includes('/') ? currentProjectPath.split('/').slice(0, -1).join('/') : '';
    fbList(startDir);
  }
  function closeFileBrowser() { document.getElementById('fb-overlay').classList.remove('open'); }
  async function fbConfirm() {
    const msg = document.getElementById('fb-msg');
    msg.textContent = '';
    if (fbMode === 'open') {
      if (!fbSelected || fbSelected.isDir) { msg.textContent = 'Selecione um arquivo .json.'; return; }
      const rel = fbCurrentDir ? fbCurrentDir + '/' + fbSelected.name : fbSelected.name;
      const res = await fetch('/api/file?path=' + encodeURIComponent(rel));
      if (!res.ok) { msg.textContent = 'Erro ao carregar o arquivo.'; return; }
      const data = await res.json();
      currentProjectPath = rel;
      updateProjectDisplay();
      applyProjectData(data.content);
      closeFileBrowser();
    } else {
      let filename = document.getElementById('fb-filename').value.trim();
      if (!filename) { msg.textContent = 'Digite um nome de arquivo.'; return; }
      if (!filename.toLowerCase().endsWith('.json')) filename += '.json';
      const rel = fbCurrentDir ? fbCurrentDir + '/' + filename : filename;
      const payload = buildProjectData(filename.replace(/\.json$/i, ''));
      const res = await fetch('/api/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: rel, content: payload, overwrite: true }) });
      if (!res.ok) { msg.textContent = 'Erro ao salvar.'; return; }
      currentProjectPath = rel;
      updateProjectDisplay();
      closeFileBrowser();
    }
  }
  async function saveCurrent() {
    if (!currentProjectPath) { openFileBrowser('save'); return; }
    const payload = buildProjectData();
    const res = await fetch('/api/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentProjectPath, content: payload, overwrite: true }) });
    if (!res.ok) { alert('Erro ao salvar o projeto.'); return; }
    const btn = document.getElementById('btn-save');
    const old = btn.textContent; btn.textContent = 'Salvo ✓';
    setTimeout(() => { btn.textContent = old; }, 1200);
  }
  function wireProjectToolbar() {
    document.getElementById('btn-open').onclick = () => openFileBrowser('open');
    document.getElementById('btn-save').onclick = saveCurrent;
    document.getElementById('btn-saveas').onclick = () => openFileBrowser('save');
    document.getElementById('fb-close').onclick = closeFileBrowser;
    document.getElementById('fb-confirm').onclick = fbConfirm;
    document.getElementById('fb-overlay').addEventListener('click', (e) => { if (e.target.id === 'fb-overlay') closeFileBrowser(); });
    document.getElementById('fb-newfolder').onclick = async () => {
      const name = prompt('Nome da nova pasta:');
      if (!name) return;
      const rel = fbCurrentDir ? fbCurrentDir + '/' + name : name;
      await fetch('/api/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: rel }) });
      fbList(fbCurrentDir);
    };
    updateProjectDisplay();
  }
  async function wireHubNav() {
    const who = await fetch('/api/whoami').then(r => r.json()).catch(() => ({ authed: false }));
    if (!who.authed) { window.location.href = '/login.html'; return; }
    document.getElementById('hubnav-who').textContent = who.username;
    document.getElementById('hubnav-logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); window.location.href = '/login.html'; };
  }
  function wireTheme() {
    const btn = document.getElementById('btn-theme');
    if (!btn) return;
    btn.onclick = () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const next = cur === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('hub-theme', next); } catch (e) {}
    };
  }

  // ---------------- Init ----------------
  function init() {
    renderSidebar();
    wireTabs();
    wireProjectToolbar();
    wireHubNav();
    wireTheme();
    document.getElementById('btn-recalc').onclick = () => { readForm(); recalc(); };
    document.getElementById('btn-csv').onclick = () => {
      if (!result) return;
      const blob = new Blob([toCSV()], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'steampath_resultados.csv'; a.click();
      URL.revokeObjectURL(url);
    };
    renderEmptyState();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
