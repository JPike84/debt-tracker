import { useState, useEffect, useMemo } from "react";

const COLORS = ["#FF6B6B","#4ECDC4","#45B7D1","#96CEB4","#FFEAA7","#DDA0DD","#98D8C8","#F7DC6F","#BB8FCE","#85C1E9"];

function formatBRL(v) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}

function calcProjection(loan, months) {
  const { value, interestRate, interestType, startDate, payments = [] } = loan;
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  let remaining = value - totalPaid;
  const rows = [];
  const today = new Date();

  if (interestType === "none" || !interestRate) {
    for (let i = 1; i <= months; i++) {
      const d = new Date(today);
      d.setMonth(d.getMonth() + i);
      rows.push({ month: d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }), balance: remaining, interest: 0 });
    }
  } else if (interestType === "simple") {
    const rate = interestRate / 100;
    for (let i = 1; i <= months; i++) {
      const interest = value * rate * i;
      const bal = (value - totalPaid) + interest;
      const d = new Date(today);
      d.setMonth(d.getMonth() + i);
      rows.push({ month: d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }), balance: Math.max(0, bal), interest: interest });
    }
  } else {
    const rate = interestRate / 100;
    let bal = remaining;
    for (let i = 1; i <= months; i++) {
      const interest = bal * rate;
      bal = bal + interest;
      const d = new Date(today);
      d.setMonth(d.getMonth() + i);
      rows.push({ month: d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }), balance: Math.max(0, bal), interest });
    }
  }
  return rows;
}

export default function App() {
  const [loans, setLoans] = useState(() => {
    try { return JSON.parse(localStorage.getItem("debt_loans") || "[]"); } catch { return []; }
  });
  const [view, setView] = useState("dashboard");
  const [selectedCreditor, setSelectedCreditor] = useState(null);
  const [projMonths, setProjMonths] = useState(6);
  const [form, setForm] = useState({ creditor: "", value: "", interestRate: "", interestType: "none", description: "", startDate: new Date().toISOString().slice(0,10) });
  const [payForm, setPayForm] = useState({ loanId: null, amount: "", date: new Date().toISOString().slice(0,10), note: "" });
  const [showPayModal, setShowPayModal] = useState(false);
  const [expandedLoan, setExpandedLoan] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // stores loan id to delete

  // Simulation state
  const [sim, setSim] = useState({
    value: "", interestRate: "", interestType: "compound", monthlyPayment: "", targetInstallments: ""
  });
  const [simMode, setSimMode] = useState("byPayment"); // byPayment | byInstallments

  const simResult = useMemo(() => {
    const value = parseFloat(sim.value);
    const rate = parseFloat(sim.interestRate) / 100;
    const hasInterest = sim.interestType !== "none" && rate > 0;

    if (!value || value <= 0) return null;

    if (simMode === "byPayment") {
      const monthly = parseFloat(sim.monthlyPayment);
      if (!monthly || monthly <= 0) return null;

      // Check if payment covers at least the first month's interest
      if (hasInterest) {
        const firstInterest = sim.interestType === "compound" ? value * rate : value * rate;
        if (monthly <= firstInterest) return { error: `Pagamento mínimo deve ser maior que ${new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(firstInterest)} (juros do 1º mês)` };
      }

      const rows = [];
      let bal = value;
      let totalInterest = 0;
      let month = 1;
      const today = new Date();
      const MAX = 600;

      while (bal > 0.01 && month <= MAX) {
        const d = new Date(today);
        d.setMonth(d.getMonth() + month);
        let interest = 0;
        if (hasInterest) {
          interest = sim.interestType === "compound" ? bal * rate : value * rate;
        }
        const payment = Math.min(monthly, bal + interest);
        const principal = payment - interest;
        bal = Math.max(0, bal - principal);
        totalInterest += interest;
        rows.push({
          month: month,
          label: d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }),
          payment, interest, principal, balance: bal, totalInterest
        });
        month++;
        if (bal < 0.01) break;
      }
      if (month > MAX) return { error: "Com esse pagamento a dívida nunca será quitada (juros > parcela)" };

      return { rows, totalPaid: rows.reduce((s,r)=>s+r.payment,0), totalInterest, installments: rows.length };

    } else {
      const installments = parseInt(sim.targetInstallments);
      if (!installments || installments <= 0) return null;

      // Calculate required monthly payment
      let monthly;
      if (!hasInterest) {
        monthly = value / installments;
      } else if (sim.interestType === "simple") {
        monthly = (value + value * rate * installments) / installments;
      } else {
        // PMT formula: P * r * (1+r)^n / ((1+r)^n - 1)
        monthly = value * rate * Math.pow(1+rate, installments) / (Math.pow(1+rate, installments) - 1);
      }

      const rows = [];
      let bal = value;
      let totalInterest = 0;
      const today = new Date();

      for (let i = 1; i <= installments; i++) {
        const d = new Date(today);
        d.setMonth(d.getMonth() + i);
        let interest = 0;
        if (hasInterest) {
          interest = sim.interestType === "compound" ? bal * rate : value * rate;
        }
        const payment = i < installments ? monthly : bal + interest;
        const principal = payment - interest;
        bal = Math.max(0, bal - principal);
        totalInterest += interest;
        rows.push({
          month: i,
          label: d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }),
          payment, interest, principal, balance: bal, totalInterest
        });
      }

      return { rows, totalPaid: rows.reduce((s,r)=>s+r.payment,0), totalInterest, installments, monthly };
    }
  }, [sim, simMode]);

  useEffect(() => {
    localStorage.setItem("debt_loans", JSON.stringify(loans));
  }, [loans]);

  const creditors = useMemo(() => {
    const map = {};
    loans.forEach(l => {
      if (!map[l.creditor]) map[l.creditor] = [];
      map[l.creditor].push(l);
    });
    return map;
  }, [loans]);

  const totalDebt = useMemo(() => loans.reduce((s, l) => {
    const paid = (l.payments || []).reduce((a,p) => a+p.amount, 0);
    return s + Math.max(0, l.value - paid);
  }, 0), [loans]);

  function addLoan() {
    if (!form.creditor || !form.value) return;
    const loan = {
      id: Date.now().toString(),
      creditor: form.creditor.trim(),
      value: parseFloat(form.value),
      interestRate: parseFloat(form.interestRate) || 0,
      interestType: form.interestType,
      description: form.description,
      startDate: form.startDate,
      payments: [],
      createdAt: new Date().toISOString()
    };
    setLoans(prev => [...prev, loan]);
    setForm({ creditor: "", value: "", interestRate: "", interestType: "none", description: "", startDate: new Date().toISOString().slice(0,10) });
    setView("dashboard");
  }

  function addPayment() {
    if (!payForm.amount || !payForm.loanId) return;
    setLoans(prev => prev.map(l => l.id === payForm.loanId ? {
      ...l,
      payments: [...(l.payments||[]), { id: Date.now().toString(), amount: parseFloat(payForm.amount), date: payForm.date, note: payForm.note }]
    } : l));
    setShowPayModal(false);
    setPayForm({ loanId: null, amount: "", date: new Date().toISOString().slice(0,10), note: "" });
  }

  function deleteLoan(id) {
    setConfirmDelete(id);
  }

  function confirmDeleteLoan() {
    setLoans(prev => prev.filter(l => l.id !== confirmDelete));
    setConfirmDelete(null);
  }


  function getLoanBalance(loan) {
    const paid = (loan.payments || []).reduce((s,p) => s+p.amount, 0);
    return Math.max(0, loan.value - paid);
  }

  function getCreditorColor(creditor) {
    const keys = Object.keys(creditors);
    return COLORS[keys.indexOf(creditor) % COLORS.length];
  }

  const creditorList = Object.entries(creditors);

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh", background: "#0D0F1A", color: "#E8EAF6" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1A1D2E,#0D0F1A)", borderBottom: "1px solid #2A2D3E", padding: "0 24px", display: "flex", alignItems: "center", gap: 24, height: 64, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, color: "#FF6B6B", letterSpacing: -0.5 }}>💸 DebtTracker</div>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {[["dashboard","📊 Painel"],["add","➕ Nova Dívida"],["projection","📈 Projeção"],["simulation","🧮 Simulador"]].map(([k,l]) => (
            <button key={k} onClick={() => setView(k)} style={{ padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, background: view===k ? "#FF6B6B" : "transparent", color: view===k ? "#fff" : "#8B8FA8", transition: "all 0.2s" }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 16px" }}>

        {/* DASHBOARD */}
        {view === "dashboard" && (
          <div>
            {/* Summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16, marginBottom: 32 }}>
              {[
                { label: "Total em Dívidas", value: formatBRL(totalDebt), icon: "💰", color: "#FF6B6B" },
                { label: "Credores", value: Object.keys(creditors).length, icon: "🏦", color: "#4ECDC4" },
                { label: "Empréstimos", value: loans.length, icon: "📋", color: "#45B7D1" },
                { label: "Total Pago", value: formatBRL(loans.reduce((s,l)=>(l.payments||[]).reduce((a,p)=>a+p.amount,s),0)), icon: "✅", color: "#96CEB4" },
              ].map((c,i) => (
                <div key={i} style={{ background: "#1A1D2E", borderRadius: 16, padding: "20px", border: `1px solid ${c.color}22` }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{c.icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.value}</div>
                  <div style={{ fontSize: 12, color: "#8B8FA8", marginTop: 4 }}>{c.label}</div>
                </div>
              ))}
            </div>

            {/* Creditors */}
            {creditorList.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#8B8FA8" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🤷</div>
                <div style={{ fontSize: 18, marginBottom: 8 }}>Nenhuma dívida registrada</div>
                <button onClick={() => setView("add")} style={{ padding: "10px 24px", background: "#FF6B6B", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontWeight: 600 }}>Adicionar primeira dívida</button>
              </div>
            ) : (
              creditorList.map(([creditor, cLoans]) => {
                const color = getCreditorColor(creditor);
                const total = cLoans.reduce((s,l) => s+getLoanBalance(l), 0);
                const totalOrig = cLoans.reduce((s,l) => s+l.value, 0);
                const isOpen = selectedCreditor === creditor;
                return (
                  <div key={creditor} style={{ background: "#1A1D2E", borderRadius: 16, marginBottom: 16, border: `1px solid ${isOpen ? color+"66" : "#2A2D3E"}`, overflow: "hidden", transition: "border 0.2s" }}>
                    {/* Creditor header */}
                    <div onClick={() => setSelectedCreditor(isOpen ? null : creditor)} style={{ padding: "18px 20px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 12, height: 12, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{creditor}</div>
                        <div style={{ fontSize: 12, color: "#8B8FA8", marginTop: 2 }}>{cLoans.length} empréstimo{cLoans.length>1?"s":""} • original: {formatBRL(totalOrig)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 700, fontSize: 18, color }}>{formatBRL(total)}</div>
                        <div style={{ fontSize: 11, color: "#8B8FA8" }}>saldo devedor</div>
                      </div>
                      <div style={{ color: "#8B8FA8", marginLeft: 8, transition: "transform 0.2s", transform: isOpen?"rotate(180deg)":"none" }}>▼</div>
                    </div>

                    {/* Loans list */}
                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${color}33`, padding: "12px 20px 20px" }}>
                        {cLoans.map(loan => {
                          const balance = getLoanBalance(loan);
                          const pct = loan.value > 0 ? ((loan.value - balance) / loan.value) * 100 : 0;
                          const isExpanded = expandedLoan === loan.id;
                          return (
                            <div key={loan.id} style={{ background: "#13162B", borderRadius: 12, padding: 16, marginBottom: 10, border: "1px solid #2A2D3E" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 600 }}>{loan.description || "Empréstimo"}</div>
                                  <div style={{ fontSize: 12, color: "#8B8FA8", marginTop: 2 }}>
                                    {loan.startDate} • {loan.interestType === "none" ? "Sem juros" : `Juros ${loan.interestType === "simple" ? "simples" : "compostos"} ${loan.interestRate}%/mês`}
                                  </div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontWeight: 700, color }}>{formatBRL(balance)}</div>
                                  <div style={{ fontSize: 11, color: "#8B8FA8" }}>de {formatBRL(loan.value)}</div>
                                </div>
                              </div>
                              {/* Progress bar */}
                              <div style={{ marginTop: 10, height: 4, background: "#2A2D3E", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.5s" }} />
                              </div>
                              <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button onClick={() => { setPayForm(p=>({...p,loanId:loan.id})); setShowPayModal(true); }} style={{ padding: "4px 12px", background: color+"22", border: `1px solid ${color}66`, borderRadius: 6, color, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>💳 Registrar pagamento</button>
                                <button onClick={() => setExpandedLoan(isExpanded?null:loan.id)} style={{ padding: "4px 12px", background: "#2A2D3E", border: "none", borderRadius: 6, color: "#8B8FA8", cursor: "pointer", fontSize: 12 }}>📜 Histórico</button>
                                <button onClick={() => deleteLoan(loan.id)} style={{ padding: "4px 12px", background: "#FF6B6B11", border: "1px solid #FF6B6B33", borderRadius: 6, color: "#FF6B6B", cursor: "pointer", fontSize: 12 }}>🗑</button>
                              </div>
                              {isExpanded && (
                                <div style={{ marginTop: 12, borderTop: "1px solid #2A2D3E", paddingTop: 12 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: "#8B8FA8", marginBottom: 8 }}>HISTÓRICO DE PAGAMENTOS</div>
                                  {(loan.payments||[]).length === 0 ? <div style={{ fontSize: 12, color: "#8B8FA8" }}>Nenhum pagamento registrado</div> : (
                                    loan.payments.map(p => (
                                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #2A2D3E22" }}>
                                        <span style={{ color: "#8B8FA8" }}>{p.date} {p.note && `• ${p.note}`}</span>
                                        <span style={{ color: "#96CEB4", fontWeight: 600 }}>-{formatBRL(p.amount)}</span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <button onClick={() => { setForm(f=>({...f, creditor})); setView("add"); }} style={{ width: "100%", padding: "10px", background: `${color}11`, border: `1px dashed ${color}55`, borderRadius: 10, color, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>+ Novo empréstimo com {creditor}</button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ADD LOAN */}
        {view === "add" && (
          <div style={{ maxWidth: 500, margin: "0 auto" }}>
            <h2 style={{ fontSize: 24, fontFamily: "'Space Grotesk',sans-serif", marginBottom: 24 }}>Nova Dívida</h2>
            <div style={{ background: "#1A1D2E", borderRadius: 20, padding: 28, border: "1px solid #2A2D3E", display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { label: "Credor *", key: "creditor", type: "text", placeholder: "Ex: Banco do Brasil, João..." },
                { label: "Descrição", key: "description", type: "text", placeholder: "Ex: Financiamento carro, Pessoal..." },
                { label: "Valor Total *", key: "value", type: "number", placeholder: "0,00" },
                { label: "Data de início", key: "startDate", type: "date" },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ fontSize: 12, color: "#8B8FA8", fontWeight: 600, display: "block", marginBottom: 6 }}>{f.label}</label>
                  <input type={f.type} value={form[f.key]} onChange={e => setForm(p=>({...p,[f.key]:e.target.value}))} placeholder={f.placeholder}
                    style={{ width: "100%", padding: "10px 14px", background: "#13162B", border: "1px solid #2A2D3E", borderRadius: 10, color: "#E8EAF6", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                </div>
              ))}
              <div>
                <label style={{ fontSize: 12, color: "#8B8FA8", fontWeight: 600, display: "block", marginBottom: 6 }}>Tipo de Juros</label>
                <select value={form.interestType} onChange={e => setForm(p=>({...p,interestType:e.target.value}))} style={{ width: "100%", padding: "10px 14px", background: "#13162B", border: "1px solid #2A2D3E", borderRadius: 10, color: "#E8EAF6", fontSize: 14, outline: "none" }}>
                  <option value="none">Sem juros</option>
                  <option value="simple">Juros Simples</option>
                  <option value="compound">Juros Compostos</option>
                </select>
              </div>
              {form.interestType !== "none" && (
                <div>
                  <label style={{ fontSize: 12, color: "#8B8FA8", fontWeight: 600, display: "block", marginBottom: 6 }}>Taxa de Juros (% ao mês)</label>
                  <input type="number" value={form.interestRate} onChange={e => setForm(p=>({...p,interestRate:e.target.value}))} placeholder="Ex: 2.5"
                    style={{ width: "100%", padding: "10px 14px", background: "#13162B", border: "1px solid #2A2D3E", borderRadius: 10, color: "#E8EAF6", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                </div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button onClick={() => setView("dashboard")} style={{ flex: 1, padding: "12px", background: "#2A2D3E", border: "none", borderRadius: 12, color: "#E8EAF6", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
                <button onClick={addLoan} style={{ flex: 2, padding: "12px", background: "linear-gradient(135deg,#FF6B6B,#ee5a5a)", border: "none", borderRadius: 12, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 15 }}>Salvar Dívida</button>
              </div>
            </div>
          </div>
        )}

        {/* PROJECTION */}
        {view === "projection" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
              <h2 style={{ fontSize: 24, fontFamily: "'Space Grotesk',sans-serif", margin: 0 }}>📈 Projeção Futura</h2>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 13, color: "#8B8FA8" }}>Meses:</label>
                <select value={projMonths} onChange={e => setProjMonths(+e.target.value)} style={{ padding: "6px 12px", background: "#1A1D2E", border: "1px solid #2A2D3E", borderRadius: 8, color: "#E8EAF6", fontSize: 14 }}>
                  {[3,6,12,24,36].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            {loans.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#8B8FA8" }}>Adicione dívidas para ver a projeção</div>
            ) : (
              loans.map(loan => {
                const proj = calcProjection(loan, projMonths);
                const color = getCreditorColor(loan.creditor);
                const maxBal = Math.max(...proj.map(p=>p.balance), loan.value);
                return (
                  <div key={loan.id} style={{ background: "#1A1D2E", borderRadius: 16, padding: 20, marginBottom: 20, border: "1px solid #2A2D3E" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
                      <div style={{ fontWeight: 700 }}>{loan.creditor}</div>
                      <div style={{ fontSize: 13, color: "#8B8FA8" }}>— {loan.description || "Empréstimo"}</div>
                      <div style={{ marginLeft: "auto", fontSize: 12, color, fontWeight: 600 }}>
                        {loan.interestType === "none" ? "Sem juros" : `${loan.interestType === "simple" ? "Simples" : "Compostos"} ${loan.interestRate}%/mês`}
                      </div>
                    </div>

                    {/* Mini chart */}
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80, marginBottom: 12 }}>
                      {proj.map((p, i) => (
                        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                          <div style={{ width: "100%", background: color + "44", borderRadius: "3px 3px 0 0", height: `${maxBal > 0 ? (p.balance/maxBal)*70 : 0}px`, minHeight: 2, position: "relative" }}>
                            {p.interest > 0 && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "#FF6B6B55", height: `${(p.interest/p.balance)*100}%`, borderRadius: "3px 3px 0 0" }} />}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Table */}
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr>
                            {["Mês","Saldo","Juros Acum."].map(h => (
                              <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "#8B8FA8", fontWeight: 600, borderBottom: "1px solid #2A2D3E", whiteSpace: "nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {proj.map((p, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid #2A2D3E22" }}>
                              <td style={{ padding: "6px 10px", color: "#8B8FA8" }}>{p.month}</td>
                              <td style={{ padding: "6px 10px", fontWeight: 600, color }}>{formatBRL(p.balance)}</td>
                              <td style={{ padding: "6px 10px", color: "#FF6B6B" }}>{p.interest > 0 ? formatBRL(p.interest) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}

            {/* Consolidated projection */}
            {creditorList.length > 1 && (
              <div style={{ background: "#1A1D2E", borderRadius: 16, padding: 20, border: "1px solid #FF6B6B33" }}>
                <h3 style={{ margin: "0 0 16px", fontFamily: "'Space Grotesk',sans-serif", color: "#FF6B6B" }}>📊 Consolidado por Credor</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {["Credor","Hoje","Daqui {m} meses".replace("{m}",projMonths),"Variação"].map(h => (
                        <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "#8B8FA8", fontWeight: 600, borderBottom: "1px solid #2A2D3E", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {creditorList.map(([creditor, cLoans]) => {
                      const color = getCreditorColor(creditor);
                      const nowBalance = cLoans.reduce((s,l)=>s+getLoanBalance(l),0);
                      const futureBalance = cLoans.reduce((s,l)=>{
                        const proj = calcProjection(l, projMonths);
                        return s + (proj[proj.length-1]?.balance||0);
                      },0);
                      const diff = futureBalance - nowBalance;
                      return (
                        <tr key={creditor} style={{ borderBottom: "1px solid #2A2D3E33" }}>
                          <td style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                            {creditor}
                          </td>
                          <td style={{ padding: "8px 10px", fontWeight: 600 }}>{formatBRL(nowBalance)}</td>
                          <td style={{ padding: "8px 10px", fontWeight: 700, color }}>{formatBRL(futureBalance)}</td>
                          <td style={{ padding: "8px 10px", color: diff > 0 ? "#FF6B6B" : "#96CEB4", fontWeight: 600 }}>
                            {diff > 0 ? "+" : ""}{formatBRL(diff)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {/* SIMULATION */}
        {view === "simulation" && (
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <h2 style={{ fontSize: 24, fontFamily: "'Space Grotesk',sans-serif", marginBottom: 6 }}>🧮 Simulador de Empréstimo</h2>
            <p style={{ color: "#8B8FA8", fontSize: 14, marginBottom: 24 }}>Simule um novo empréstimo e veja o plano de quitação completo — sem salvar nada.</p>

            <div style={{ background: "#1A1D2E", borderRadius: 20, padding: 24, border: "1px solid #2A2D3E", marginBottom: 24 }}>
              {/* Mode toggle */}
              <div style={{ display: "flex", background: "#13162B", borderRadius: 10, padding: 4, marginBottom: 20, width: "fit-content" }}>
                {[["byPayment","Por valor da parcela"],["byInstallments","Por nº de parcelas"]].map(([m,l]) => (
                  <button key={m} onClick={() => setSimMode(m)} style={{ padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: simMode===m ? "#FFEAA7" : "transparent", color: simMode===m ? "#1A1D2E" : "#8B8FA8", transition: "all 0.2s" }}>{l}</button>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, color: "#8B8FA8", fontWeight: 600, display: "block", marginBottom: 6 }}>Valor do Empréstimo *</label>
                  <input type="number" value={sim.value} onChange={e => setSim(p=>({...p,value:e.target.value}))} placeholder="R$ 0,00"
                    style={{ width: "100%", padding: "10px 14px", background: "#13162B", border: "1px solid #2A2D3E", borderRadius: 10, color: "#E8EAF6", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#8B8FA8", fontWeight: 600, display: "block", marginBottom: 6 }}>Tipo de Juros</label>
                  <select value={sim.interestType} onChange={e => setSim(p=>({...p,interestType:e.target.value}))} style={{ width: "100%", padding: "10px 14px", background: "#13162B", border: "1px solid #2A2D3E", borderRadius: 10, color: "#E8EAF6", fontSize: 14, outline: "none" }}>
                    <option value="none">Sem juros</option>
                    <option value="simple">Juros Simples</option>
                    <option value="compound">Juros Compostos</option>
                  </select>
                </div>
                {sim.interestType !== "none" && (
                  <div>
                    <label style={{ fontSize: 12, color: "#8B8FA8", fontWeight: 600, display: "block", marginBottom: 6 }}>Taxa (% ao mês)</label>
                    <input type="number" value={sim.interestRate} onChange={e => setSim(p=>({...p,interestRate:e.target.value}))} placeholder="Ex: 2.5"
                      style={{ width: "100%", padding: "10px 14px", background: "#13162B", border: "1px solid #2A2D3E", borderRadius: 10, color: "#E8EAF6", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                  </div>
                )}
                {simMode === "byPayment" ? (
                  <div>
                    <label style={{ fontSize: 12, color: "#8B8FA8", fontWeight: 600, display: "block", marginBottom: 6 }}>Valor que pode pagar/mês *</label>
                    <input type="number" value={sim.monthlyPayment} onChange={e => setSim(p=>({...p,monthlyPayment:e.target.value}))} placeholder="R$ 0,00"
                      style={{ width: "100%", padding: "10px 14px", background: "#13162B", border: "1px solid #2A2D3E", borderRadius: 10, color: "#E8EAF6", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                  </div>
                ) : (
                  <div>
                    <label style={{ fontSize: 12, color: "#8B8FA8", fontWeight: 600, display: "block", marginBottom: 6 }}>Nº de Parcelas *</label>
                    <input type="number" value={sim.targetInstallments} onChange={e => setSim(p=>({...p,targetInstallments:e.target.value}))} placeholder="Ex: 12"
                      style={{ width: "100%", padding: "10px 14px", background: "#13162B", border: "1px solid #2A2D3E", borderRadius: 10, color: "#E8EAF6", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                  </div>
                )}
              </div>
            </div>

            {/* Error */}
            {simResult?.error && (
              <div style={{ background: "#FF6B6B22", border: "1px solid #FF6B6B55", borderRadius: 12, padding: 16, marginBottom: 20, color: "#FF6B6B", fontSize: 14 }}>
                ⚠️ {simResult.error}
              </div>
            )}

            {/* Results */}
            {simResult && !simResult.error && (
              <>
                {/* Summary cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 20 }}>
                  {[
                    { label: "Parcelas", value: simResult.installments + "x", icon: "📆", color: "#FFEAA7" },
                    { label: simMode==="byInstallments" ? "Valor da parcela" : "Valor/mês", value: formatBRL(simMode==="byInstallments" ? simResult.monthly : parseFloat(sim.monthlyPayment)), icon: "💵", color: "#4ECDC4" },
                    { label: "Total Pago", value: formatBRL(simResult.totalPaid), icon: "💸", color: "#FF6B6B" },
                    { label: "Total de Juros", value: formatBRL(simResult.totalInterest), icon: "📈", color: "#DDA0DD" },
                    { label: "Custo extra", value: `+${simResult.totalPaid > 0 ? ((simResult.totalInterest / parseFloat(sim.value)) * 100).toFixed(1) : 0}%`, icon: "📊", color: "#96CEB4" },
                  ].map((c,i) => (
                    <div key={i} style={{ background: "#1A1D2E", borderRadius: 14, padding: "16px", border: `1px solid ${c.color}22` }}>
                      <div style={{ fontSize: 22, marginBottom: 6 }}>{c.icon}</div>
                      <div style={{ fontWeight: 700, fontSize: 18, color: c.color }}>{c.value}</div>
                      <div style={{ fontSize: 11, color: "#8B8FA8", marginTop: 3 }}>{c.label}</div>
                    </div>
                  ))}
                </div>

                {/* Visual payoff bar */}
                <div style={{ background: "#1A1D2E", borderRadius: 16, padding: 20, marginBottom: 20, border: "1px solid #2A2D3E" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#8B8FA8", marginBottom: 10 }}>COMPOSIÇÃO DO CUSTO TOTAL</div>
                  <div style={{ display: "flex", height: 24, borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ width: `${(parseFloat(sim.value)/simResult.totalPaid)*100}%`, background: "#4ECDC4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#1A1D2E" }}>
                      {((parseFloat(sim.value)/simResult.totalPaid)*100).toFixed(0)}% principal
                    </div>
                    <div style={{ flex: 1, background: "#FF6B6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>
                      {((simResult.totalInterest/simResult.totalPaid)*100).toFixed(0)}% juros
                    </div>
                  </div>

                  {/* Mini bar chart - balance over time */}
                  <div style={{ marginTop: 16, fontSize: 13, fontWeight: 600, color: "#8B8FA8", marginBottom: 8 }}>EVOLUÇÃO DO SALDO</div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60 }}>
                    {(simResult.rows.length > 36 ? simResult.rows.filter((_,i,a) => i % Math.ceil(a.length/36) === 0 || i === a.length-1) : simResult.rows).map((r,i,arr) => (
                      <div key={i} style={{ flex: 1, background: `hsl(${160 + (r.balance/parseFloat(sim.value))*60},60%,50%)`, borderRadius: "2px 2px 0 0", minHeight: 2, height: `${Math.max(2,(r.balance/parseFloat(sim.value))*58)}px`, transition: "height 0.3s" }} title={`${r.label}: ${formatBRL(r.balance)}`} />
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8B8FA8", marginTop: 4 }}>
                    <span>Mês 1</span><span>Mês {simResult.installments}</span>
                  </div>
                </div>

                {/* Full amortization table */}
                <div style={{ background: "#1A1D2E", borderRadius: 16, border: "1px solid #2A2D3E", overflow: "hidden" }}>
                  <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2D3E", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Tabela de Amortização Completa</div>
                    <div style={{ fontSize: 12, color: "#8B8FA8" }}>{simResult.installments} parcelas</div>
                  </div>
                  <div style={{ overflowX: "auto", maxHeight: 380, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead style={{ position: "sticky", top: 0, background: "#1A1D2E" }}>
                        <tr>
                          {["#","Mês","Parcela","Juros","Amort.","Saldo"].map(h => (
                            <th key={h} style={{ padding: "10px 12px", textAlign: "right", color: "#8B8FA8", fontWeight: 600, borderBottom: "1px solid #2A2D3E", whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {simResult.rows.map((r, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #2A2D3E22", background: i%2===0?"transparent":"#13162B22" }}>
                            <td style={{ padding: "7px 12px", textAlign: "right", color: "#8B8FA8" }}>{r.month}</td>
                            <td style={{ padding: "7px 12px", textAlign: "right", color: "#8B8FA8" }}>{r.label}</td>
                            <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 600, color: "#FFEAA7" }}>{formatBRL(r.payment)}</td>
                            <td style={{ padding: "7px 12px", textAlign: "right", color: "#FF6B6B" }}>{r.interest > 0.005 ? formatBRL(r.interest) : "—"}</td>
                            <td style={{ padding: "7px 12px", textAlign: "right", color: "#4ECDC4" }}>{formatBRL(r.principal)}</td>
                            <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 600 }}>{formatBRL(r.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {!simResult && (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#8B8FA8" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🔢</div>
                Preencha os campos acima para ver a simulação
              </div>
            )}
          </div>
        )}

      </div>
      {showPayModal && (
        <div style={{ position: "fixed", inset: 0, background: "#00000088", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16 }}>
          <div style={{ background: "#1A1D2E", borderRadius: 20, padding: 28, width: "100%", maxWidth: 380, border: "1px solid #2A2D3E" }}>
            <h3 style={{ margin: "0 0 20px", fontFamily: "'Space Grotesk',sans-serif" }}>💳 Registrar Pagamento</h3>
            {[
              { label: "Valor pago *", key: "amount", type: "number", placeholder: "0,00" },
              { label: "Data", key: "date", type: "date" },
              { label: "Observação", key: "note", type: "text", placeholder: "Parcela #1, quitação..." },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: "#8B8FA8", fontWeight: 600, display: "block", marginBottom: 6 }}>{f.label}</label>
                <input type={f.type} value={payForm[f.key]} onChange={e => setPayForm(p=>({...p,[f.key]:e.target.value}))} placeholder={f.placeholder}
                  style={{ width: "100%", padding: "10px 14px", background: "#13162B", border: "1px solid #2A2D3E", borderRadius: 10, color: "#E8EAF6", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowPayModal(false)} style={{ flex: 1, padding: 12, background: "#2A2D3E", border: "none", borderRadius: 12, color: "#E8EAF6", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
              <button onClick={addPayment} style={{ flex: 2, padding: 12, background: "linear-gradient(135deg,#4ECDC4,#3db8b0)", border: "none", borderRadius: 12, color: "#fff", cursor: "pointer", fontWeight: 700 }}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "#00000088", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16 }}>
          <div style={{ background: "#1A1D2E", borderRadius: 20, padding: 28, width: "100%", maxWidth: 340, border: "1px solid #FF6B6B55", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🗑️</div>
            <h3 style={{ margin: "0 0 8px", fontFamily: "'Space Grotesk',sans-serif" }}>Remover empréstimo?</h3>
            <p style={{ color: "#8B8FA8", fontSize: 14, marginBottom: 24 }}>Essa ação não pode ser desfeita.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, padding: 12, background: "#2A2D3E", border: "none", borderRadius: 12, color: "#E8EAF6", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
              <button onClick={confirmDeleteLoan} style={{ flex: 1, padding: 12, background: "linear-gradient(135deg,#FF6B6B,#ee5a5a)", border: "none", borderRadius: 12, color: "#fff", cursor: "pointer", fontWeight: 700 }}>Remover</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
