import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
	getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, getDoc, setDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
	getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Firebase 설정
const firebaseConfig = {
	apiKey: "AIzaSyDlWT7cgcEuWB_kPmWuAITf6fUzeQwfYCU",
	authDomain: "my-forex-invest.firebaseapp.com",
	projectId: "my-forex-invest",
	storageBucket: "my-forex-invest.firebasestorage.app",
	messagingSenderId: "744299180454",
	appId: "1:744299180454:web:33dc12d8db0ccf75c3df67"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const AUTH_ACCOUNT_EMAIL = "admin@forex.local";

window.db = db;
window.fs = { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, getDoc, setDoc, query, orderBy };
window.auth = auth;

// 전역 상태 관리
let isRateLoaded = false; // 환율 수신 여부 (스켈레톤 동기화 플래그)
let currentRateSource = { source: 'loading', time: '' };

let globalData = {
	usd: { currentPrice: 1357.67, history: [] },
	jpy: { currentPrice: 915.20, history: [] },
	soldHistory: [],
	settings: {
		USD_BASE_PRICE: 1300, USD_GAP: 10,
		JPY_BASE_PRICE: 900, JPY_GAP: 5,
		FINANCE_LIST: "하나은행,토스뱅크,삼성증권,스위치원,국민은행,신한은행,테더"
	}
};

let recordModal;
let currentSoldFilter = 'all';
let currentSoldPage = 1;
let currentSoldPageSize = 10;

function escapeHtml(unsafe) {
	if (unsafe == null) return '';
	return String(unsafe)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function safeMultiply(a, b) {
	return Number((Number(a) * Number(b)).toFixed(6));
}

function formatDateTime(d) {
	const date = d instanceof Date ? d : new Date(d);
	if (isNaN(date.getTime())) return d;
	const pad = (n) => (n < 10 ? '0' + n : n);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// 🔑 인증 및 로그인 처리
window.loginWithPassword = async function () {
	const pwdInput = document.getElementById('site-password');
	const pwd = pwdInput.value;
	if (!pwd) {
		Swal.fire({ icon: 'warning', title: '비밀번호를 입력하세요.', confirmButtonText: '확인' });
		return;
	}

	showLoading("비밀번호 확인 중...");
	try {
		await signInWithEmailAndPassword(auth, AUTH_ACCOUNT_EMAIL, pwd);
		hideLoading();
	} catch (e) {
		hideLoading();
		Swal.fire({
			icon: 'error',
			title: '접속 실패',
			text: '비밀번호가 올바르지 않습니다.',
			confirmButtonText: '확인'
		});
		pwdInput.value = '';
	}
};

window.logoutSession = async function () {
	await signOut(auth);
	location.reload();
};

onAuthStateChanged(auth, (user) => {
	hideLoading();
	if (user) {
		document.getElementById('auth-screen').style.display = 'none';
		document.getElementById('main-content').style.display = 'block';
		initFirebaseListeners();
		refreshCurrentRates();
	} else {
		document.getElementById('main-content').style.display = 'none';
		document.getElementById('auth-screen').style.display = 'flex';
		setTimeout(() => {
			const pwdInput = document.getElementById('site-password');
			if (pwdInput) pwdInput.focus();
		}, 60);
	}
});

// 🔄 GAS 캐시 서버 연동 및 환율 수신
window.refreshCurrentRates = async function () {
	isRateLoaded = false;
	renderDashboard(globalData); // 스켈레톤 로딩 상태 렌더링

	const gasUrl = "https://script.google.com/macros/s/AKfycbyV4J5VZ_Og5vbQxpoqinTn4UXce3o4Dig9cbR-Yam4IewdfMz3snXAmdjLUPWP2KLe7g/exec";

	try {
		const response = await fetch(gasUrl);
		if (!response.ok) throw new Error("GAS 서버 응답 실패");

		const data = await response.json();
		const usdRate = data.usdkrw?.price;
		const jpyRate = data.jpykrw?.price;

		if (usdRate && jpyRate) {
			globalData.usd.currentPrice = Number(usdRate.toFixed(2));
			globalData.jpy.currentPrice = Number(jpyRate.toFixed(2));

			let timeStr = "";
			if (data.timestamp) {
				const match = data.timestamp.match(/(\d{2}:\d{2})/);
				timeStr = match ? match[1] : data.timestamp.slice(-8, -3);
			}

			currentRateSource = {
				source: 'yahoo',
				badgeText: `🟢 Yahoo ${timeStr ? '(' + timeStr + ' 기준)' : ''}`
			};
			isRateLoaded = true;
			renderDashboard(globalData);
			return;
		}
		throw new Error("환율 데이터 구조 없음");

	} catch (err) {
		console.warn("⚠️ GAS 환율 수신 지연, 백업 오픈 API 가동:", err.message);
		try {
			const altRes = await fetch("https://open.er-api.com/v6/latest/USD");
			const altData = await altRes.json();
			if (altData?.rates) {
				globalData.usd.currentPrice = Number(altData.rates.KRW.toFixed(2));
				globalData.jpy.currentPrice = Number(((altData.rates.KRW / altData.rates.JPY) * 100).toFixed(2));

				const now = new Date();
				const pad = (n) => (n < 10 ? '0' + n : n);
				const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

				currentRateSource = {
					source: 'backup',
					badgeText: `🟡 OpenAPI (${timeStr} 기준)`
				};
				isRateLoaded = true;
				renderDashboard(globalData);
			}
		} catch (e2) {
			console.error("❌ 환율 수신 전체 실패:", e2);
			isRateLoaded = true;
			renderDashboard(globalData);
		}
	}
};

// ======================== Firebase 실시간 리스너 ========================
function initFirebaseListeners() {
	const { collection, onSnapshot, query, orderBy, doc, setDoc } = window.fs;

	onSnapshot(doc(window.db, "settings", "general"), (docSnap) => {
		if (docSnap.exists()) {
			globalData.settings = docSnap.data();
			applySettingsToInputs();
			renderDashboard(globalData);
		} else {
			setDoc(doc(window.db, "settings", "general"), globalData.settings);
		}
	});

	const qTrades = query(collection(window.db, "investments"), orderBy("createdAt", "desc"));
	onSnapshot(qTrades, (snapshot) => {
		const usdList = [];
		const jpyList = [];
		let usdNo = 1, jpyNo = 1;

		const docs = [];
		snapshot.forEach(d => docs.push({ id: d.id, ...d.data() }));
		docs.reverse();

		docs.forEach(item => {
			if (item.type === 'usd') {
				usdList.push({ ...item, no: usdNo++ });
			} else if (item.type === 'jpy') {
				jpyList.push({ ...item, no: jpyNo++ });
			}
		});

		globalData.usd.history = usdList.reverse();
		globalData.jpy.history = jpyList.reverse();

		localStorage.setItem('forex_invest_cache', JSON.stringify(globalData));
		renderDashboard(globalData);
	});

	const qSold = query(collection(window.db, "soldHistory"), orderBy("createdAt", "desc"));
	onSnapshot(qSold, (snapshot) => {
		const soldList = [];
		let soldNo = 1;
		const docs = [];
		snapshot.forEach(d => docs.push({ id: d.id, ...d.data() }));
		docs.reverse();

		docs.forEach(item => {
			soldList.push({ ...item, no: soldNo++ });
		});

		globalData.soldHistory = soldList.reverse();
		localStorage.setItem('forex_invest_cache', JSON.stringify(globalData));
		renderDashboard(globalData);
	});
}

function getFinanceBadge(name) {
	if (!name) return '';
	let bgColor = '#495057', textColor = '#ffffff';
	if (name.includes('토스')) { bgColor = '#3182f6'; }
	else if (name.includes('삼성')) { bgColor = '#1428a0'; }
	else if (name.includes('하나')) { bgColor = '#008485'; }
	else if (name.includes('키움')) { bgColor = '#d81347'; }
	else if (name.includes('NH') || name.includes('나무')) { bgColor = '#ffcc00'; textColor = '#111111'; }
	else if (name.includes('국민') || name.includes('KB')) { bgColor = '#ffbc00'; textColor = '#111111'; }
	else if (name.includes('신한')) { bgColor = '#0b40e4'; }
	else if (name.includes('카카오')) { bgColor = '#ffe812'; textColor = '#111111'; }
	else if (name.includes('미래에셋')) { bgColor = '#ff6200'; }
	else if (name.includes('한국투자') || name.includes('한투')) { bgColor = '#000000'; }
	return `<span class="shadow-sm" style="height: 28px; padding: 0 12px; font-weight: 700; border-radius: 30px; font-size: 0.8rem; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; background-color: ${bgColor}; color: ${textColor}; letter-spacing: -0.02em;">${name}</span>`;
}

function showLoading(text) {
	document.getElementById('loading-text').innerText = text || "데이터 처리 중...";
	document.getElementById('loading').style.display = 'flex';
}

function hideLoading() {
	document.getElementById('loading').style.display = 'none';
}

function applySettingsToInputs() {
	if (globalData && globalData.settings) {
		document.getElementById('input-usd-base').value = Number(globalData.settings.USD_BASE_PRICE) || 0;
		document.getElementById('input-usd-gap').value = Number(globalData.settings.USD_GAP) || 0;
		document.getElementById('input-jpy-base').value = Number(globalData.settings.JPY_BASE_PRICE) || 0;
		document.getElementById('input-jpy-gap').value = Number(globalData.settings.JPY_GAP) || 0;
		const financeListStr = globalData.settings.FINANCE_LIST || "하나은행,토스뱅크,삼성증권";
		document.getElementById('input-finance-list').value = financeListStr;

		const financeSelect = document.getElementById('form-finance');
		financeSelect.innerHTML = '';
		financeListStr.split(',').forEach(item => {
			const val = item.trim();
			if (val) {
				const opt = document.createElement('option');
				opt.value = val;
				opt.innerText = val;
				financeSelect.appendChild(opt);
			}
		});
	}
}

function renderDashboard(data) {
	if (!data || !data.settings) return;
	applySettingsToInputs();
	renderCurrencySection('usd', data.usd);
	renderCurrencySection('jpy', data.jpy);
	processAndRenderSoldData();
}

// 💵 달러 / 엔화 렌더링 (PC / 모바일 통합 포지션 버튼 적용)
function renderCurrencySection(type, currencyData) {
	const current = Number(currencyData.currentPrice) || 0;
	const history = currencyData.history || [];
	const tbody = document.getElementById(type + '-table-body');
	const mDiv = document.getElementById(type + '-mobile-list');
	tbody.innerHTML = '';
	mDiv.innerHTML = '';

	let sumTotalBuy = 0;
	let sumForeignAmount = 0;
	let sumTotalValuation = 0;

	// 1. 차수별 리스트 렌더링
	if (history.length === 0) {
		tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted py-4">누적된 투자 기록이 없습니다.</td></tr>`;
		mDiv.innerHTML = `<div class="text-center text-muted py-4">누적된 투자 기록이 없습니다.</div>`;
	} else {
		history.forEach(item => {
			const buyPrice = Number(item.buyPrice) || 0;
			const foreignAmount = Number(item.foreignAmount) || 0;
			const totalBuy = Number(item.totalBuy) || 0;
			const unitIcon = type === 'usd' ? '\$' : '¥';
			const safeFinance = escapeHtml(item.finance);
			const safeDateText = escapeHtml(item.date || '-');
			const financeStrEscaped = safeFinance.replace(/'/g, "\\'");

			sumTotalBuy += totalBuy;
			sumForeignAmount += foreignAmount;

			const currentValuation = type === 'jpy' ? safeMultiply(foreignAmount, current) / 100 : safeMultiply(foreignAmount, current);
			const currentProfit = Number((currentValuation - totalBuy).toFixed(4));
			sumTotalValuation += currentValuation;

			const profitRate = totalBuy > 0 ? ((currentProfit / totalBuy) * 100).toFixed(2) : "0.00";
			const isProfit = currentProfit > 0;

			// PC 및 모바일 공용 포지션 버튼 / 뱃지
			let positionActionHtml = "";
			let profitAmtText = "";
			let profitRateText = "";
			let valuationText = "";

			if (!isRateLoaded) {
				positionActionHtml = `<span class="skeleton-loading" style="width: 90px; height: 28px;"></span>`;
				profitAmtText = `<span class="skeleton-loading" style="width: 60px;"></span>`;
				profitRateText = `<span class="skeleton-loading" style="width: 45px;"></span>`;
				valuationText = `<span class="skeleton-loading" style="width: 70px;"></span>`;
			} else {
				valuationText = Math.round(currentValuation).toLocaleString() + "원";
				profitAmtText = (currentProfit >= 0 ? '+' : '') + Math.round(currentProfit).toLocaleString() + "원";
				profitRateText = (currentProfit >= 0 ? '+' : '') + profitRate + '%';

				if (isProfit) {
					// PC & 모바일 공통: 익절 가능한 경우 클릭하여 바로 매도하는 통합 버튼
					positionActionHtml = `<button type="button" class="btn-position-sell-action" onclick="executeSale('${type}', '${item.id}', ${current})">🔥 +${profitRate}% 팔기 <i class="fas fa-chevron-right" style="font-size:0.7rem;"></i></button>`;
				} else {
					// 보유 중인 경우 상태 뱃지만 유지
					positionActionHtml = `<span class="badge-status-hold">⏳ ${profitRate}% 보유 중</span>`;
				}
			}

			const stockClass = !isRateLoaded ? '' : (currentProfit > 0 ? 'stock-up' : (currentProfit < 0 ? 'stock-down' : 'stock-stable'));

			// 관리 열은 수정 및 삭제 아이콘만 깔끔하게 구성
			const editTools = `
				<button type="button" class="btn btn-outline-primary btn-action-icon" title="수정" onclick="openEditModal('${type}', '${item.id}', '${safeDateText}', ${buyPrice}, ${foreignAmount}, ${totalBuy}, '${financeStrEscaped}')"><i class="fas fa-edit"></i></button>
				<button type="button" class="btn btn-outline-danger btn-action-icon ms-1" title="삭제" onclick="deleteRecord('${item.id}')"><i class="fas fa-trash-alt"></i></button>
			`;

			// PC 테이블 행
			const tr = document.createElement('tr');
			if (isRateLoaded && isProfit) tr.style.backgroundColor = '#fffdfd';
			tr.innerHTML = `
				<td class="text-muted fw-bold">${item.no}</td>
				<td>${getFinanceBadge(safeFinance)}</td>
				<td>${safeDateText}</td>
				<td>${buyPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}원</td>
				<td class="fw-bold">${unitIcon}${foreignAmount.toLocaleString()}</td>
				<td>${totalBuy.toLocaleString()}원</td>
				<td>${valuationText}</td>
				<td class="${stockClass}">${profitAmtText}</td>
				<td class="${stockClass}">${profitRateText}</td>
				<td class="text-center">${positionActionHtml}</td>
				<td class="text-center d-flex justify-content-center align-items-center">${editTools}</td>
			`;
			tbody.appendChild(tr);

			// 모바일 전용 카드
			const mCard = document.createElement('div');
			mCard.className = 'mobile-record-card' + (isRateLoaded && isProfit ? ' profit-active' : '');
			mCard.innerHTML = `
				<div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
					<span class="fw-bold text-secondary fs-6 d-flex align-items-center">
						No.${item.no} <span class="ms-2">${getFinanceBadge(safeFinance)}</span>
					</span>
					<div>${positionActionHtml}</div>
				</div>
				<div class="row g-2 small text-dark mb-3">
					<div class="col-6"><div class="text-muted mb-1" style="font-size:0.75rem;">매수일자</div><div class="fw-bold">${safeDateText.replace(' ', '<br>')}</div></div>
					<div class="col-6"><div class="text-muted mb-1" style="font-size:0.75rem;">매수환율(₩)</div><div class="fw-bold">${buyPrice.toLocaleString()}원</div></div>
					<div class="col-6"><div class="text-muted mb-1" style="font-size:0.75rem;">매수수량</div><div class="fw-bold">${unitIcon}${foreignAmount.toLocaleString()}</div></div>
					<div class="col-6"><div class="text-muted mb-1" style="font-size:0.75rem;">매수금(₩)</div><div class="fw-bold">${totalBuy.toLocaleString()}원</div></div>
					<div class="col-12"><div class="text-muted mb-1" style="font-size:0.75rem;">평가금(₩)</div><div class="fw-bold">${valuationText}</div></div>
				</div>
				<div class="d-flex justify-content-between align-items-center border-top pt-2 mt-1">
					<div class="lh-sm">
						<span class="small text-muted" style="font-size:0.75rem;">손익: </span>
						<span class="${stockClass} fw-bold">${profitAmtText}</span>
						<span class="${stockClass} small">(${profitRateText})</span>
					</div>
					<div class="d-flex align-items-center">${editTools}</div>
				</div>
			`;
			mDiv.appendChild(mCard);
		});
	}

	// 2. 상단 요약 카드 계산 및 바인딩
	let avgBuyPrice = 0;
	if (sumForeignAmount > 0) {
		avgBuyPrice = type === 'jpy' ? (sumTotalBuy / sumForeignAmount) * 100 : (sumTotalBuy / sumForeignAmount);
	}

	const prefix = type === 'usd' ? '🇺🇸 USD ' : '🇯🇵 JPY ';
	document.getElementById(type + '-total-asset').innerText = prefix + sumForeignAmount.toLocaleString();
	document.getElementById(type + '-sum-krw').innerText = sumTotalBuy.toLocaleString() + '원';
	document.getElementById(type + '-avg-buy').innerText = avgBuyPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '원';

	const valEl = document.getElementById(type + '-current-valuation');
	const rateEl = document.getElementById(type + '-current-rate');
	const badgeEl = document.getElementById(type + '-rate-badge');
	const badgeTextEl = document.getElementById(type + '-rate-source-text');
	const profitAmtEl = document.getElementById(type + '-total-profit-amt');
	const profitRateEl = document.getElementById(type + '-total-profit-rate');
	const profitContainer = document.getElementById(type + '-total-profit-container');

	if (!isRateLoaded) {
		valEl.innerHTML = `<span class="skeleton-loading" style="width: 100px;"></span>`;
		rateEl.innerHTML = `<span class="skeleton-loading" style="width: 80px;"></span>`;
		badgeEl.className = 'source-badge';
		badgeTextEl.innerText = "환율 확인 중...";
		profitAmtEl.innerHTML = `<span class="skeleton-loading" style="width: 85px;"></span>`;
		profitRateEl.innerHTML = `<span class="skeleton-loading" style="width: 50px;"></span>`;
		profitContainer.className = 'profit-footer-value';
	} else {
		valEl.innerText = Math.round(sumTotalValuation).toLocaleString() + '원';
		rateEl.innerText = current.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '원';
		badgeEl.className = 'source-badge ' + (currentRateSource.source === 'yahoo' ? 'badge-yahoo' : 'badge-backup');
		badgeTextEl.innerText = currentRateSource.badgeText;

		// 총 평가손익 바 계산
		const totalProfit = Math.round(sumTotalValuation - sumTotalBuy);
		const totalProfitRate = sumTotalBuy > 0 ? ((totalProfit / sumTotalBuy) * 100).toFixed(2) : "0.00";
		const sign = totalProfit > 0 ? '+' : '';

		profitAmtEl.innerText = `${sign}${totalProfit.toLocaleString()}원`;
		profitRateEl.innerText = `(${sign}${totalProfitRate}%)`;

		profitContainer.className = 'profit-footer-value ' + (totalProfit > 0 ? 'profit-up' : (totalProfit < 0 ? 'profit-down' : 'profit-zero'));
	}
}

// 💰 실현 손익 처리 및 페이지네이션
function processAndRenderSoldData() {
	const soldList = globalData.soldHistory || [];
	let totalAccumulatedProfit = 0, usdAccumulatedProfit = 0, jpyAccumulatedProfit = 0;

	soldList.forEach(item => {
		totalAccumulatedProfit += item.profit;
		if (item.type === '달러') usdAccumulatedProfit += item.profit;
		if (item.type === '엔화') jpyAccumulatedProfit += item.profit;
	});

	document.getElementById('total-accumulated-profit').innerText = (totalAccumulatedProfit >= 0 ? '+' : '') + totalAccumulatedProfit.toLocaleString() + "원";
	document.getElementById('usd-accumulated-profit').innerText = (usdAccumulatedProfit >= 0 ? '+' : '') + usdAccumulatedProfit.toLocaleString() + "원";
	document.getElementById('jpy-accumulated-profit').innerText = (jpyAccumulatedProfit >= 0 ? '+' : '') + jpyAccumulatedProfit.toLocaleString() + "원";

	let filteredList = soldList;
	if (currentSoldFilter !== 'all') filteredList = soldList.filter(item => item.type === currentSoldFilter);

	const totalItems = filteredList.length;
	const totalPages = Math.ceil(totalItems / currentSoldPageSize) || 1;
	if (currentSoldPage > totalPages) currentSoldPage = totalPages;

	const startIndex = (currentSoldPage - 1) * currentSoldPageSize;
	const endIndex = Math.min(startIndex + currentSoldPageSize, totalItems);
	const pagedList = filteredList.slice(startIndex, endIndex);

	const tbody = document.getElementById('sold-table-body');
	const mDiv = document.getElementById('sold-mobile-list');
	tbody.innerHTML = '';
	mDiv.innerHTML = '';

	if (pagedList.length === 0) {
		tbody.innerHTML = `<tr><td colspan="12" class="text-center text-muted py-4">해당 내역이 존재하지 않습니다.</td></tr>`;
		mDiv.innerHTML = `<div class="text-center text-muted py-3">해당 내역이 존재하지 않습니다.</div>`;
	} else {
		pagedList.forEach(item => {
			const displayNo = item.no;
			const profitClass = item.profit > 0 ? 'stock-up' : (item.profit < 0 ? 'stock-down' : 'stock-stable');
			const profitSign = item.profit >= 0 ? '+' : '';
			const badgeClass = item.type === '달러' ? 'bg-white border border-primary text-primary' : 'bg-white border border-danger text-danger';
			const textBadgeHtml = `<span class="badge ${badgeClass} px-3 py-2 fs-6">${item.type === '달러' ? '💵 달러' : '💴 엔화'}</span>`;

			const safeFinance = escapeHtml(item.finance);
			const safeBuyDate = escapeHtml(item.buyDate);
			const safeSellDate = escapeHtml(item.sellDate);

			const tr = document.createElement('tr');
			tr.innerHTML = `
				<td class="text-muted fw-bold">${displayNo}</td>
				<td>${getFinanceBadge(safeFinance)}</td>
				<td>${textBadgeHtml}</td>
				<td>${safeBuyDate}</td>
				<td>${item.buyPrice.toLocaleString()}원</td>
				<td class="fw-bold">${item.amount.toLocaleString()}</td>
				<td>${item.totalBuy.toLocaleString()}원</td>
				<td>${safeSellDate}</td>
				<td>${item.sellPrice.toLocaleString()}원</td>
				<td>${item.totalSell.toLocaleString()}원</td>
				<td class="${profitClass} fw-bold">${profitSign}${item.profit.toLocaleString()}원</td>
				<td class="text-center"><button type="button" class="btn btn-outline-danger btn-action-icon" title="삭제" onclick="deleteHistoryRecord('${item.id}')"><i class="fas fa-trash-alt"></i></button></td>
			`;
			tbody.appendChild(tr);

			const cardBorderColor = item.type === '달러' ? '#0d6efd' : '#dc3545';
			const mCard = document.createElement('div');
			mCard.className = 'mobile-record-card';
			mCard.style.borderLeft = '5px solid ' + cardBorderColor;
			mCard.innerHTML = `
				<div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
					<span class="fw-bold text-dark d-flex align-items-center">
						<span class="text-muted small me-2">No.${displayNo}</span> ${getFinanceBadge(safeFinance)} <span class="ms-1">${textBadgeHtml}</span>
					</span>
					<button type="button" class="btn btn-outline-danger btn-action-icon" title="삭제" onclick="deleteHistoryRecord('${item.id}')"><i class="fas fa-trash-alt"></i></button>
				</div>
				<div class="row g-2 small text-dark mb-3">
					<div class="col-6"><div class="text-muted mb-1" style="font-size:0.75rem;">매수일자</div><div class="fw-bold">${safeBuyDate.replace(' ', '<br>')}</div></div>
					<div class="col-6"><div class="text-muted mb-1" style="font-size:0.75rem;">매도일자</div><div class="fw-bold">${safeSellDate.replace(' ', '<br>')}</div></div>
					<div class="col-6"><div class="text-muted mb-1" style="font-size:0.75rem;">매수환율</div><div class="fw-bold">${item.buyPrice.toLocaleString()}원</div></div>
					<div class="col-6"><div class="text-muted mb-1" style="font-size:0.75rem;">매도환율</div><div class="fw-bold">${item.sellPrice.toLocaleString()}원</div></div>
					<div class="col-6"><div class="text-muted mb-1" style="font-size:0.75rem;">매수원금</div><div class="fw-bold">${item.totalBuy.toLocaleString()}원</div></div>
					<div class="col-6"><div class="text-muted mb-1" style="font-size:0.75rem;">정산금액</div><div class="fw-bold">${item.totalSell.toLocaleString()}원</div></div>
				</div>
				<div class="border-top pt-2 mt-1 d-flex justify-content-between align-items-center">
					<span class="text-muted small">확정 실현손익</span><span class="${profitClass} fw-bold fs-5">${profitSign}${item.profit.toLocaleString()}원</span>
				</div>
			`;
			mDiv.appendChild(mCard);
		});
	}
	renderPaginationNav(totalPages);
}

window.changeSoldFilter = function (filterValue) { currentSoldFilter = filterValue; currentSoldPage = 1; processAndRenderSoldData(); };
window.changeSoldPageSize = function () { currentSoldPageSize = parseInt(document.getElementById('soldPageSize').value) || 10; currentSoldPage = 1; processAndRenderSoldData(); };
window.setSoldPage = function (pageNumber) { currentSoldPage = pageNumber; processAndRenderSoldData(); };

function renderPaginationNav(totalPages) {
	const navEl = document.getElementById('sold-pagination-nav');
	navEl.innerHTML = '';
	if (totalPages <= 1) return;
	const ul = document.createElement('ul');
	ul.className = 'pagination pagination-sm m-0 shadow-sm';

	const prevLi = document.createElement('li');
	prevLi.className = 'page-item' + (currentSoldPage === 1 ? ' disabled' : '');
	prevLi.innerHTML = `<a class="page-link" href="#" onclick="window.setSoldPage(${currentSoldPage - 1}); return false;"><i class="fas fa-chevron-left"></i></a>`;
	ul.appendChild(prevLi);

	for (let p = 1; p <= totalPages; p++) {
		const pLi = document.createElement('li');
		pLi.className = 'page-item' + (currentSoldPage === p ? ' active' : '');
		pLi.innerHTML = `<a class="page-link fw-bold" href="#" onclick="window.setSoldPage(${p}); return false;">${p}</a>`;
		ul.appendChild(pLi);
	}

	const nextLi = document.createElement('li');
	nextLi.className = 'page-item' + (currentSoldPage === totalPages ? ' disabled' : '');
	nextLi.innerHTML = `<a class="page-link" href="#" onclick="window.setSoldPage(${currentSoldPage + 1}); return false;"><i class="fas fa-chevron-right"></i></a>`;
	ul.appendChild(nextLi);

	navEl.appendChild(ul);
}

// 💰 매도 익절 확정 실행
window.executeSale = async function (type, docId, defaultPrice) {
	const formattedDefault = (type === 'jpy' && defaultPrice < 50) ? defaultPrice * 100 : defaultPrice;

	const result = await Swal.fire({
		title: '매도 익절 확정',
		html: `해당 데이터를 실현 손익으로 이관합니다.<br><br>
               <div class="text-start mb-1 fw-bold small text-secondary">적용할 매도 환율(₩)</div>
               <input type="number" id="swal-input-sell-price" class="form-control form-control-lg text-primary fw-bold" value="${formattedDefault.toFixed(2)}" step="0.01">`,
		icon: 'question',
		showCancelButton: true, confirmButtonColor: '#198754', cancelButtonColor: '#6c757d', confirmButtonText: '네, 이관 후 삭제', cancelButtonText: '취소',
		didOpen: () => {
			const input = document.getElementById('swal-input-sell-price');
			if (input) { input.focus(); input.select(); }
		},
		preConfirm: () => {
			const val = document.getElementById('swal-input-sell-price').value;
			if (!val || Number(val) <= 0) Swal.showValidationMessage('유효한 매도 환율을 입력해주세요.');
			return Number(val);
		}
	});

	if (result.isConfirmed) {
		const manualSellPrice = result.value;
		showLoading("기록을 이관 처리 중입니다...");

		try {
			const docRef = window.fs.doc(window.db, "investments", docId);
			const docSnap = await window.fs.getDoc(docRef);
			if (!docSnap.exists()) throw new Error("문서를 찾을 수 없습니다.");

			const item = docSnap.data();
			const sellDate = formatDateTime(new Date());
			const amount = Number(item.foreignAmount) || 0;
			const totalBuy = Number(item.totalBuy) || 0;

			let totalSell = type === 'jpy' ? (amount * manualSellPrice / 100) : (amount * manualSellPrice);
			totalSell = Math.round(Number(totalSell.toFixed(4)));
			const profit = totalSell - totalBuy;

			await window.fs.addDoc(window.fs.collection(window.db, "soldHistory"), {
				type: type === 'usd' ? "달러" : "엔화",
				buyDate: item.date,
				buyPrice: item.buyPrice,
				amount: amount,
				totalBuy: totalBuy,
				sellDate: sellDate,
				sellPrice: manualSellPrice,
				totalSell: totalSell,
				profit: profit,
				finance: item.finance || "",
				createdAt: Date.now()
			});

			await window.fs.deleteDoc(docRef);

			hideLoading();
			Swal.fire({
				icon: 'success',
				title: '정산 완료',
				text: '실현손익으로 안전하게 이관되었습니다.',
				confirmButtonText: '확인',
				timer: 2000,
				timerProgressBar: true
			});
		} catch (err) {
			hideLoading();
			Swal.fire({ icon: 'error', title: '처리 오류', text: err.message, confirmButtonText: '확인' });
		}
	}
};

window.calculateTotalBuy = function () {
	const price = Number(document.getElementById('form-price').value) || 0;
	const amount = Number(document.getElementById('form-amount').value) || 0;
	const type = document.getElementById('form-type').value;
	if (price > 0 && amount > 0) {
		const total = type === 'jpy' ? safeMultiply(price, amount) / 100 : safeMultiply(price, amount);
		document.getElementById('form-totalbuy').value = Math.round(total);
	}
};

window.openAddModal = function (type) {
	document.getElementById('recordForm').reset();
	document.getElementById('form-type').value = type;
	document.getElementById('form-docid').value = '';
	const financeSelect = document.getElementById('form-finance');
	if (financeSelect.options.length > 0) financeSelect.selectedIndex = 0;
	const dateInput = document.getElementById('form-date');
	if (dateInput._flatpickr) dateInput._flatpickr.setDate(new Date());

	document.getElementById('submitBtn').innerText = '추가하기';
	document.getElementById('submitBtn').className = 'btn btn-primary px-4 btn-sm';

	if (type === 'usd') {
		document.getElementById('modalTitle').innerHTML = '💵 달러 투자 기록 추가';
		document.getElementById('label-price-unit').innerText = '매수환율(₩)';
		document.getElementById('label-foreign').innerText = '매수수량 (\$)';
		const currentUsd = globalData.usd ? parseFloat(globalData.usd.currentPrice) : 0;
		document.getElementById('form-price').value = currentUsd > 0 ? currentUsd.toFixed(2) : "";
		document.getElementById('form-amount').value = 1000;
	} else {
		document.getElementById('modalTitle').innerHTML = '💴 엔화 투자 기록 추가';
		document.getElementById('label-price-unit').innerText = '매수환율(₩)';
		document.getElementById('label-foreign').innerText = '매수수량 (¥)';
		const currentJpy = globalData.jpy ? parseFloat(globalData.jpy.currentPrice) : 0;
		document.getElementById('form-price').value = currentJpy > 0 ? currentJpy.toFixed(2) : "";
		document.getElementById('form-amount').value = 100000;
	}
	window.calculateTotalBuy();
	recordModal.show();
};

window.openEditModal = function (type, docId, date, buyPrice, foreignAmount, totalBuy, finance) {
	document.getElementById('form-type').value = type;
	document.getElementById('form-docid').value = docId;
	const dateInput = document.getElementById('form-date');
	if (dateInput._flatpickr) dateInput._flatpickr.setDate(date);
	else dateInput.value = date;

	document.getElementById('form-price').value = Number(buyPrice);
	document.getElementById('form-amount').value = Number(foreignAmount);
	document.getElementById('form-totalbuy').value = Math.round(Number(totalBuy));
	document.getElementById('form-finance').value = finance || '';

	document.getElementById('submitBtn').innerText = '수정';
	document.getElementById('submitBtn').className = 'btn btn-success px-4 btn-sm';
	document.getElementById('label-price-unit').innerText = '매수환율(₩)';
	document.getElementById('label-foreign').innerText = type === 'usd' ? '매수수량 (\$)' : '매수수량 (¥)';
	document.getElementById('modalTitle').innerHTML = type === 'usd' ? '💵 달러 투자 기록 수정' : '💴 엔화 투자 기록 수정';
	recordModal.show();
};

window.deleteRecord = async function (docId) {
	const result = await Swal.fire({
		title: '데이터 삭제 경고',
		text: "해당 투자 기록이 즉시 영구 삭제됩니다.",
		icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc3545', cancelButtonColor: '#6c757d', confirmButtonText: '삭제', cancelButtonText: '취소'
	});

	if (result.isConfirmed) {
		showLoading("삭제 중...");
		try {
			await window.fs.deleteDoc(window.fs.doc(window.db, "investments", docId));
			hideLoading();
			Swal.fire({ icon: 'success', title: '삭제 성공', confirmButtonText: '확인', timer: 1800, timerProgressBar: true });
		} catch (err) {
			hideLoading();
			Swal.fire({ icon: 'error', title: '삭제 실패', text: err.message, confirmButtonText: '확인' });
		}
	}
};

window.deleteHistoryRecord = async function (docId) {
	const result = await Swal.fire({
		title: '실현손익 데이터 삭제',
		text: "이 실현손익 기록을 데이터베이스에서 영구히 삭제합니까?",
		icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc3545', cancelButtonColor: '#6c757d', confirmButtonText: '삭제', cancelButtonText: '취소'
	});

	if (result.isConfirmed) {
		showLoading("삭제 처리 중...");
		try {
			await window.fs.deleteDoc(window.fs.doc(window.db, "soldHistory", docId));
			hideLoading();
			Swal.fire({ icon: 'success', title: '삭제 완료', confirmButtonText: '확인', timer: 1800, timerProgressBar: true });
		} catch (err) {
			hideLoading();
			Swal.fire({ icon: 'error', title: '삭제 실패', text: err.message, confirmButtonText: '확인' });
		}
	}
};

// DOM 로드 완료 이벤트 리스너
document.addEventListener("DOMContentLoaded", () => {
	recordModal = new bootstrap.Modal(document.getElementById('recordModal'));

	const cachedData = localStorage.getItem('forex_invest_cache');
	if (cachedData) {
		try {
			globalData = JSON.parse(cachedData);
			renderDashboard(globalData);
		} catch (e) { console.error("캐시 파싱 오류", e); }
	}

	const settingTabBtn = document.getElementById('setting-tab');
	if (settingTabBtn) {
		settingTabBtn.addEventListener('shown.bs.tab', applySettingsToInputs);
	}

	flatpickr("#form-date", {
		enableTime: true,
		enableSeconds: true,
		time_24hr: true,
		dateFormat: "Y-m-d H:i:S",
		disableMobile: true,
		minuteIncrement: 1
	});

	document.getElementById('recordModal').addEventListener('shown.bs.modal', () => {
		const priceInput = document.getElementById('form-price');
		if (priceInput) {
			priceInput.focus();
			priceInput.select();
		}
	});

	// 매수 기록 저장 폼 리스너
	document.getElementById('recordForm').addEventListener('submit', async (e) => {
		e.preventDefault();
		const type = document.getElementById('form-type').value;
		const docId = document.getElementById('form-docid').value;
		const date = document.getElementById('form-date').value;
		const buyPrice = Number(document.getElementById('form-price').value);
		const foreignAmount = Number(document.getElementById('form-amount').value);
		const totalBuy = Number(document.getElementById('form-totalbuy').value);
		const finance = document.getElementById('form-finance').value;

		recordModal.hide();
		showLoading("데이터 저장 중...");

		try {
			if (!docId) {
				await window.fs.addDoc(window.fs.collection(window.db, "investments"), {
					type: type,
					date: date,
					buyPrice: buyPrice,
					foreignAmount: foreignAmount,
					totalBuy: totalBuy,
					finance: finance,
					memo: "보유중",
					createdAt: Date.now()
				});
			} else {
				await window.fs.updateDoc(window.fs.doc(window.db, "investments", docId), {
					date: date,
					buyPrice: buyPrice,
					foreignAmount: foreignAmount,
					totalBuy: totalBuy,
					finance: finance
				});
			}
			hideLoading();
			Swal.fire({ icon: 'success', title: '저장 완료', confirmButtonText: '확인', timer: 1800, timerProgressBar: true });
		} catch (err) {
			hideLoading();
			Swal.fire({ icon: 'error', title: '저장 실패', text: err.message, confirmButtonText: '확인' });
		}
	});

	// 설정 저장 폼 리스너
	document.getElementById('settingForm').addEventListener('submit', async (e) => {
		e.preventDefault();
		const usdBase = Number(document.getElementById('input-usd-base').value);
		const usdGap = Number(document.getElementById('input-usd-gap').value);
		const jpyBase = Number(document.getElementById('input-jpy-base').value);
		const jpyGap = Number(document.getElementById('input-jpy-gap').value);
		const financeList = document.getElementById('input-finance-list').value;

		showLoading("설정값 저장 중...");
		try {
			await window.fs.setDoc(window.fs.doc(window.db, "settings", "general"), {
				USD_BASE_PRICE: usdBase,
				USD_GAP: usdGap,
				JPY_BASE_PRICE: jpyBase,
				JPY_GAP: jpyGap,
				FINANCE_LIST: financeList
			});
			hideLoading();
			Swal.fire({ icon: 'success', title: '설정 저장 성공', confirmButtonText: '확인', timer: 1800, timerProgressBar: true });
		} catch (err) {
			hideLoading();
			Swal.fire({ icon: 'error', title: '저장 실패', text: err.message, confirmButtonText: '확인' });
		}
	});
});