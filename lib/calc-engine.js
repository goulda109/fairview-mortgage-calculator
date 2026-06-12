/**
 * Fairview Mortgage Calculator — pure calc engine.
 * No DOM, no globals beyond the namespace. Importable in browser, worker, or test runner.
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.MortgageEngine = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // Canadian semi-annual compounding → per-payment effective rate
    function getEffectiveRate(annualRate, paymentsPerYear) {
        const semi = annualRate / 2;
        return Math.pow(1 + semi, 2 / paymentsPerYear) - 1;
    }

    function getCMHCPremium(ltvPercent) {
        if (ltvPercent <= 65) return 0.006;
        if (ltvPercent <= 75) return 0.017;
        if (ltvPercent <= 80) return 0.024;
        if (ltvPercent <= 85) return 0.028;
        if (ltvPercent <= 90) return 0.031;
        if (ltvPercent <= 95) return 0.04;
        return 0;
    }

    function resolveFrequency(freqVal) {
        if (freqVal === 26.089) return { paymentsPerYear: 26, isAccelerated: true };
        if (freqVal === 52.178) return { paymentsPerYear: 52, isAccelerated: true };
        return { paymentsPerYear: freqVal, isAccelerated: false };
    }

    function calculatePayment(balance, annualRate, amortYears, paymentsPerYear, isAccelerated) {
        if (isAccelerated) {
            const rMonthly = getEffectiveRate(annualRate, 12);
            const nMonthly = amortYears * 12;
            const monthlyPayment = balance * (rMonthly * Math.pow(1 + rMonthly, nMonthly)) / (Math.pow(1 + rMonthly, nMonthly) - 1);
            return paymentsPerYear === 26 ? monthlyPayment / 2 : monthlyPayment / 4;
        }
        const r = getEffectiveRate(annualRate, paymentsPerYear);
        const n = amortYears * paymentsPerYear;
        return balance * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    }

    function buildSchedule(initialBalance, payment, annualRate, paymentsPerYear, amortYears, termYears) {
        const r = getEffectiveRate(annualRate, paymentsPerYear);
        let balance = initialBalance;
        const schedule = [];
        let totalInterest = 0, totalPrincipal = 0;
        let termInterest = 0, termPrincipal = 0, termEndBalance = initialBalance;

        for (let year = 1; year <= amortYears; year++) {
            let yearPrincipal = 0, yearInterest = 0;
            const beginBalance = balance;
            for (let p = 0; p < paymentsPerYear; p++) {
                if (balance <= 0) break;
                const interestPayment = balance * r;
                let principalPayment = payment - interestPayment;
                if (principalPayment > balance) principalPayment = balance;
                balance -= principalPayment;
                if (balance < 0) balance = 0;
                yearPrincipal += principalPayment;
                yearInterest += interestPayment;
            }
            totalInterest += yearInterest;
            totalPrincipal += yearPrincipal;
            if (year <= termYears) {
                termInterest += yearInterest;
                termPrincipal += yearPrincipal;
                termEndBalance = balance;
            }
            schedule.push({
                year,
                beginBalance,
                totalPayment: yearPrincipal + yearInterest,
                principal: yearPrincipal,
                interest: yearInterest,
                endBalance: balance
            });
            if (balance <= 0) break;
        }

        return { schedule, totalInterest, totalPrincipal, termInterest, termPrincipal, termEndBalance };
    }

    function simulateWithExtras(initialBalance, payment, annualRate, paymentsPerYear, extraPerPayment, lumpSumPerYear, maxYears) {
        const r = getEffectiveRate(annualRate, paymentsPerYear);
        let balance = initialBalance;
        let totalInterest = 0, totalPaid = 0, pmtCount = 0;
        const maxPmts = maxYears * paymentsPerYear * 2;
        while (balance > 0.01 && pmtCount < maxPmts) {
            const interest = balance * r;
            let principal = payment + extraPerPayment - interest;
            if (principal > balance) principal = balance;
            balance -= principal;
            totalInterest += interest;
            totalPaid += interest + principal;
            pmtCount++;
            if (lumpSumPerYear > 0 && pmtCount % Math.round(paymentsPerYear) === 0 && balance > 0) {
                const lump = Math.min(lumpSumPerYear, balance);
                balance -= lump;
                totalPaid += lump;
            }
            if (balance < 0.01) balance = 0;
        }
        return { totalInterest, totalPaid, yearsToPayoff: pmtCount / paymentsPerYear, pmtCount };
    }

    // Penalty: 3-month interest vs IRD; variable always uses 3-month.
    function calculatePenalty({ balance, currentRate, comparisonRate, monthsRemaining, mortgageType }) {
        const threeMonth = balance * (currentRate / 100) * (3 / 12);
        const rateDiff = Math.max(0, (currentRate - comparisonRate) / 100);
        const ird = balance * rateDiff * (monthsRemaining / 12);

        let charged, method, explain;
        if (mortgageType === 'variable') {
            charged = threeMonth;
            method = '3-month interest';
            explain = 'Variable-rate mortgages are typically charged 3 months\' interest on the outstanding balance.';
        } else if (ird >= threeMonth) {
            charged = ird;
            method = 'IRD (Interest Rate Differential)';
            explain = `IRD applies because the rate differential (${(currentRate - comparisonRate).toFixed(2)}%) over ${monthsRemaining} months remaining produces a higher penalty than 3 months' interest.`;
        } else {
            charged = threeMonth;
            method = '3-month interest';
            explain = '3 months\' interest applies because it exceeds the IRD calculation given the remaining term.';
        }
        return { threeMonth, ird, charged, method, explain };
    }

    // Land Transfer Tax — provincial brackets
    function ltOntario(price) {
        return tieredTax(price, [[55000, 0.005], [195000, 0.010], [150000, 0.015], [1400000, 0.020], [Infinity, 0.025]]);
    }
    function ltTorontoMLTT(price) {
        return tieredTax(price, [[55000, 0.005], [195000, 0.010], [150000, 0.015], [1600000, 0.020], [1000000, 0.025], [Infinity, 0.035]]);
    }
    function ltBC(price) {
        return tieredTax(price, [[200000, 0.010], [1800000, 0.020], [1000000, 0.030], [Infinity, 0.050]]);
    }
    function ltQuebec(price) {
        return tieredTax(price, [[58900, 0.005], [235700, 0.010], [Infinity, 0.015]]);
    }
    function ltManitoba(price) {
        return tieredTax(price, [[30000, 0.000], [60000, 0.005], [60000, 0.010], [50000, 0.015], [Infinity, 0.020]]) + 70;
    }
    function tieredTax(price, tiers) {
        let tax = 0, remaining = price;
        for (const [bracket, rate] of tiers) {
            const taxable = Math.min(remaining, bracket);
            tax += taxable * rate;
            remaining -= taxable;
            if (remaining <= 0) break;
        }
        return tax;
    }

    function calculateLTT(price, province, isToronto, isFirstTime) {
        let provincial = 0, municipal = 0, rebate = 0, note = '';
        switch (province) {
            case 'ON':
                provincial = ltOntario(price);
                if (isToronto) municipal = ltTorontoMLTT(price);
                if (isFirstTime) {
                    rebate = Math.min(provincial, 4000);
                    if (isToronto) rebate += Math.min(municipal, 4475);
                    note = 'ON FTB rebate up to $4,000' + (isToronto ? ' + Toronto $4,475' : '');
                }
                break;
            case 'BC':
                provincial = ltBC(price);
                if (isFirstTime && price <= 500000) {
                    rebate = provincial;
                    note = 'BC FTB full exemption (≤$500K)';
                } else if (isFirstTime && price <= 835000) {
                    rebate = provincial * Math.max(0, (835000 - price) / 335000);
                    note = 'BC FTB partial exemption ($500K–$835K)';
                }
                break;
            case 'QC':
                provincial = ltQuebec(price);
                note = 'Quebec Welcome Tax (mutation duty); some municipalities add brackets above $500K';
                break;
            case 'AB':
                provincial = 50 + Math.ceil(price / 5000);
                note = 'AB has no LTT — title registration only';
                break;
            case 'SK':
                provincial = price < 500000 ? Math.max(25, price * 0.003) : price * 0.004;
                note = 'SK title transfer fee (no LTT)';
                break;
            case 'MB': provincial = ltManitoba(price); break;
            case 'NS':
                provincial = price * 0.015;
                note = 'NS Deed Transfer Tax — varies by municipality (typical 1.5%)';
                break;
            case 'NB': provincial = price * 0.01; break;
            case 'PE':
                provincial = price * 0.01;
                if (isFirstTime && price <= 200000) {
                    rebate = provincial;
                    note = 'PEI FTB exemption to $200,000';
                }
                break;
            case 'NL':
                provincial = 100 + Math.max(0, price - 500) * 0.004;
                note = 'NL registration fee';
                break;
        }
        return { provincial, municipal, rebate, total: Math.max(0, provincial + municipal - rebate), note };
    }

    function getCmhcPstRate(province) {
        if (province === 'ON') return 0.08;
        if (province === 'QC') return 0.0975;
        if (province === 'MB') return 0.07;
        if (province === 'SK') return 0.06;
        return 0;
    }

    return {
        getEffectiveRate, getCMHCPremium, resolveFrequency,
        calculatePayment, buildSchedule, simulateWithExtras, calculatePenalty,
        calculateLTT, getCmhcPstRate,
        ltOntario, ltTorontoMLTT, ltBC, ltQuebec, ltManitoba, tieredTax
    };
}));
