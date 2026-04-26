const tickers = [
    { symbol: 'AAPL', name: 'Apple Inc.' },
    { symbol: 'MSFT', name: 'Microsoft Corporation' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.' },
    { symbol: 'TSLA', name: 'Tesla, Inc.' },
    { symbol: 'META', name: 'Meta Platforms, Inc.' },
    { symbol: 'NVDA', name: 'NVIDIA Corporation' },
    { symbol: 'NFLX', name: 'Netflix, Inc.' },
    { symbol: 'AMD', name: 'Advanced Micro Devices, Inc.' },
    { symbol: 'INTC', name: 'Intel Corporation' },
    { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.' },
    { symbol: 'V', name: 'Visa Inc.' },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
    { symbol: 'DIS', name: 'The Walt Disney Company' },
];

let myChart;

document.addEventListener('DOMContentLoaded', () => {
    const tickerInput = document.getElementById('ticker');
    const analyzeBtn = document.getElementById('analyze-btn');
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');

    // Set default dates
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    startDateInput.value = oneYearAgo.toISOString().split('T')[0];
    endDateInput.value = today.toISOString().split('T')[0];

    // Autocomplete logic
    tickerInput.addEventListener('input', function() {
        const val = this.value;
        closeAllLists();
        if (!val) return false;

        const list = document.createElement('div');
        list.setAttribute('id', this.id + 'autocomplete-list');
        list.setAttribute('class', 'autocomplete-items');
        this.parentNode.appendChild(list);

        tickers.forEach(item => {
            if (item.symbol.substr(0, val.length).toUpperCase() === val.toUpperCase() ||
                item.name.toUpperCase().includes(val.toUpperCase())) {
                const itemDiv = document.createElement('div');
                itemDiv.innerHTML = `<strong>${item.symbol.substr(0, val.length)}</strong>${item.symbol.substr(val.length)} - ${item.name}`;
                itemDiv.innerHTML += `<input type='hidden' value='${item.symbol}'>`;
                itemDiv.addEventListener('click', function() {
                    tickerInput.value = this.getElementsByTagName('input')[0].value;
                    closeAllLists();
                });
                list.appendChild(itemDiv);
            }
        });
    });

    function closeAllLists(elmnt) {
        const x = document.getElementsByClassName('autocomplete-items');
        for (let i = 0; i < x.length; i++) {
            if (elmnt != x[i] && elmnt != tickerInput) {
                x[i].parentNode.removeChild(x[i]);
            }
        }
    }

    document.addEventListener('click', function(e) {
        closeAllLists(e.target);
    });

    // Analyze button click
    analyzeBtn.addEventListener('click', () => {
        const ticker = tickerInput.value.toUpperCase();
        const startDate = new Date(startDateInput.value);
        const endDate = new Date(endDateInput.value);
        const frequency = document.getElementById('frequency').value;
        const amount = parseFloat(document.getElementById('amount').value);

        if (!ticker || !startDate || !endDate || isNaN(amount)) {
            alert('모든 필드를 올바르게 입력해주세요.');
            return;
        }

        if (startDate >= endDate) {
            alert('시작일은 종료일보다 빨라야 합니다.');
            return;
        }

        calculateDCA(ticker, startDate, endDate, frequency, amount);
    });
});

function calculateDCA(ticker, start, end, freq, amount) {
    // Show result section
    document.getElementById('result-section').style.display = 'block';

    // Mock Historical Data Generation
    // In a real app, you would fetch this from an API
    const dataPoints = [];
    const currentDate = new Date(start);
    let currentPrice = 100 + Math.random() * 50; // Random starting price

    while (currentDate <= end) {
        dataPoints.push({
            date: new Date(currentDate),
            price: currentPrice
        });
        currentDate.setDate(currentDate.getDate() + 1);
        currentPrice *= (1 + (Math.random() * 0.02 - 0.009)); // Random daily fluctuation
    }

    // DCA Logic
    let totalInvested = 0;
    let totalShares = 0;
    const history = [];

    const dcaDates = [];
    let dcaPointer = new Date(start);

    while (dcaPointer <= end) {
        dcaDates.push(new Date(dcaPointer));
        if (freq === 'daily') dcaPointer.setDate(dcaPointer.getDate() + 1);
        else if (freq === 'weekly') dcaPointer.setDate(dcaPointer.getDate() + 7);
        else if (freq === 'monthly') dcaPointer.setMonth(dcaPointer.getMonth() + 1);
    }

    let dcaIdx = 0;
    dataPoints.forEach(dp => {
        if (dcaIdx < dcaDates.length && dp.date.toDateString() === dcaDates[dcaIdx].toDateString()) {
            totalInvested += amount;
            totalShares += amount / dp.price;
            dcaIdx++;
        }

        history.push({
            date: dp.date.toISOString().split('T')[0],
            invested: totalInvested,
            value: totalShares * dp.price
        });
    });

    const finalValue = totalShares * dataPoints[dataPoints.length - 1].price;
    const returnRate = ((finalValue - totalInvested) / totalInvested) * 100;

    // Update UI
    document.getElementById('end-value').innerText = `$${finalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    document.getElementById('total-invested').innerText = `$${totalInvested.toLocaleString()}`;
    document.getElementById('return-rate').innerText = `${returnRate.toFixed(2)}%`;
    document.getElementById('return-rate').style.color = returnRate >= 0 ? '#10b981' : '#ef4444';

    updateChart(history);
}

function updateChart(history) {
    const ctx = document.getElementById('dcaChart').getContext('2d');

    if (myChart) {
        myChart.destroy();
    }

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: history.map(h => h.date),
            datasets: [
                {
                    label: '자산 가치 (End Value)',
                    data: history.map(h => h.value),
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    fill: true,
                    tension: 0.1,
                    pointRadius: 0
                },
                {
                    label: '누적 투자금 (Cumulative Investment)',
                    data: history.map(h => h.invested),
                    borderColor: '#64748b',
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            scales: {
                y: {
                    ticks: {
                        callback: (value) => '$' + value.toLocaleString()
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}
