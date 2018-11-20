const env = require('system').env;
const fs = require('fs');
const webpage = require('webpage');

const done = function(page: WebPage) {
	return () => {
		page.close();
		phantom.exit();
	};
};

const doneWithError = function(page: WebPage) {
	return function(error: Error) {
		console.error('An error occured ', error);
		takeSnapshot(page, 'error');
		console.log('dumping HTML...');
		fs.write(
			'page.html',
			page.evaluate(function() {
				return document.body.innerHTML;
			}),
			'w'
		);
		page.close();
		phantom.exit();
	};
};

let snapshotCounter = 0;
function takeSnapshot(page: WebPage, title: string = '') {
	if (title != '') {
		title = `-${title}`;
	}
	page.render(`snapshots/sc${snapshotCounter++}${title}.jpg`, { format: 'jpg' });
}

function waitForElement(page: WebPage, selector: string, timeout: number = 10000) {
	const getElement = function() {
		return page.evaluate(function(selector: string): HTMLElement | null {
			return document.querySelector(selector) as HTMLElement | null;
		}, selector);
	};

	const startedAt = Date.now();
	while (getElement() === null) {
		if (Date.now() - startedAt >= timeout) {
			throw new Error(`waitForElement: timeout waiting for "${selector}"`);
		}
		slimer.wait(200);
	}
}

function doLogin(page: WebPage, email: string, password: string): void {
	page.evaluate(function() {
		const $loginBtn = document.querySelector('a[href*=login]') as HTMLElement | null;
		if (!$loginBtn) {
			throw new Error('could not find login button');
		}
		$loginBtn.click();
	});

	slimer.wait(2000);

	const [$emailInput, $passwordInput, $loginSubmitBtn] = page.evaluate(function() {
		const $emailInput = document.querySelector('#login_user_form input[name=username]') as HTMLElement | null;
		const $passwordInput = document.querySelector('#login_user_form input[name=password]') as HTMLElement | null;
		const $loginSubmitBtn = document.querySelector('#login_user_form button[type=submit]') as HTMLElement | null;

		if (!$emailInput || !$passwordInput || !$loginSubmitBtn) {
			throw new Error('could not find login form');
		}

		return [$emailInput, $passwordInput, $loginSubmitBtn];
	});

	$emailInput.focus();
	page.sendEvent('keypress', email);
	$passwordInput.focus();
	page.sendEvent('keypress', password);

	click(page, $loginSubmitBtn);
	slimer.wait(2000);

	waitForElement(page, '.servingsPanel');

	// remove "Help" button
	page.evaluate(function() {
		const $help = document.getElementById('launcher') as HTMLElement | null;
		if (!$help) {
			return;
		}
		$help.parentElement && $help.parentElement.removeChild($help);
	});
}

function maybeCloseUpgradeModal(page: WebPage): boolean {
	const $closeUpgradeModalBtn = document.querySelector('button.GL-TVABCIDC') as HTMLElement | null;
	if ($closeUpgradeModalBtn) {
		click(page, $closeUpgradeModalBtn);
		return true;
	}
	return false;
}

function click(page: WebPage, $element: HTMLElement): void {
	if (maybeCloseUpgradeModal(page)) {
		console.log('click: closed upgrade modal');
	}

	const rect = $element.getBoundingClientRect() as DOMRect;
	const x = rect.x + rect.width / 2;
	const y = rect.y + rect.height / 2;
	page.sendEvent('mousemove', x, y);
	page.sendEvent('click', x, y);
	console.log(`click [${x}, ${y}]`);
}

function querySelector(page: WebPage, selector: string): HTMLElement | null {
	return page.evaluate((selector: string) => {
		return document.querySelector(selector) as HTMLElement | null;
	}, selector);
}

function getAttribute($element: HTMLElement, name: string): string | null {
	if ($element.attributes[name]) {
		return $element.attributes[name].value || null;
	}
	return null;
}

function getSelectedDate(page: WebPage): Date {
	const d = page.evaluate(function() {
		let day = 1;
		const $selectedDay = document.querySelector('.datePickerDay.datePickerDayIsValue') as HTMLElement | null;
		if ($selectedDay) {
			day = parseInt($selectedDay.innerText, 10);
		}
		return new Date(
			day + ' ' + ((document.querySelector('.datePickerMonth') as HTMLElement | null) || { innerText: '' }).innerText
		);
	});

	console.log(`[getSelectedDate] date: ${d.getDate()}, month: ${d.getMonth()}, year: ${d.getFullYear()}`);
	return d;
}

function selectDate(page: WebPage, target: Date) {
	maybeCloseUpgradeModal(page);

	const selectDate = function(date: Date) {
		const $calendarToggleBtn = page.evaluate(function(): HTMLElement {
			const $btns = document.querySelectorAll('.GL-TVABCK5B');
			if ($btns.length !== 3) {
				throw new Error('selectDate: date selector buttons not found');
			}
			return $btns[1] as HTMLElement;
		});

		waitForElement(page, '.gwt-DatePicker');
		const $datePicker = querySelector(page, '.gwt-DatePicker');
		if (!$datePicker) {
			throw new Error(`selectDate: missing date picker`);
		}
		if (getAttribute($datePicker, 'aria-hidden') === 'true') {
			$calendarToggleBtn.click();
		}

		const [$calendarPrevYearBtn, $calendarPrevMonthButton, $calendarNextMonthBtn, $calendarNextYearBtn] = page.evaluate(
			function() {
				const $prevYear = document.querySelector('.datePickerPreviousYearButton') as HTMLElement | null;
				const $prevMonth = document.querySelector('.datePickerPreviousButton') as HTMLElement | null;
				const $nextMonth = document.querySelector('.datePickerNextButton') as HTMLElement | null;
				const $nextYear = document.querySelector('.datePickerNextYearButton') as HTMLElement | null;
				if (!$prevYear || !$prevMonth || !$nextMonth || !$nextYear) {
					throw new Error('selectDate: could not find month/year selection buttons');
				}
				return [$prevYear, $prevMonth, $nextMonth, $nextYear];
			}
		);
		const d = new Date($calendarToggleBtn.innerText);

		const year = date.getFullYear();
		const month = date.getMonth();

		let selectedYear = d.getFullYear();
		while (year > selectedYear) {
			console.log(`[nextYear] year: ${year}, selectedYear: ${selectedYear}`);
			click(page, $calendarNextYearBtn);
			selectedYear = getSelectedDate(page).getFullYear();
		}
		while (year < selectedYear) {
			console.log(`[prevYear] year: ${year}, selectedYear: ${selectedYear}`);
			click(page, $calendarPrevYearBtn);
			selectedYear = getSelectedDate(page).getFullYear();
		}
		let selectedMonth = d.getMonth();
		while (month > selectedMonth) {
			console.log(`[nextMonth] month: ${month}, selectedMonth: ${selectedMonth}`);
			click(page, $calendarNextMonthBtn);
			selectedMonth = getSelectedDate(page).getMonth();
		}
		while (month < selectedMonth) {
			console.log(`[prevMonth] month: ${month}, selectedMonth: ${selectedMonth}`);
			click(page, $calendarPrevMonthButton);
			selectedMonth = getSelectedDate(page).getMonth();
		}

		const $date = page.evaluate(function(d: number): HTMLElement | null {
			return (
				Array.from(document.querySelectorAll('.datePickerDay:not(.datePickerDayIsFiller)') as NodeListOf<
					HTMLElement
				>).find((e) => e.innerText.trim() === `${d}`) || null
			);
		}, date.getDate());
		if (!$date) {
			throw new Error(`selectDate: unable to locate date (${date.getDate()}/${month}/${year})`);
		}
		click(page, $date);
		const selectedDate = getSelectedDate(page);
		let nTry = 0;
		while (
			selectedDate.getFullYear() !== year ||
			selectedDate.getMonth() !== month ||
			selectedDate.getDate() !== date.getDate()
		) {
			slimer.wait(200);
			click(page, $date);
			if (nTry++ >= 10) {
				throw new Error(`selectDate: unable to select date (${date.getDate()}/${month}/${year})`);
			}
		}
	};

	selectDate(target);
	waitForServingsPanel(page);
}

function waitForServingsPanel(page: WebPage) {
	const isLoading = function() {
		return page.evaluate(function() {
			const $tr = document.querySelector('.servingsPanel tr:nth-child(2)') as HTMLElement | null;
			if (!$tr) {
				return false;
			}
			return $tr.innerText.trim() === 'Loading...';
		});
	};

	if (!isLoading()) {
		return;
	}

	while (isLoading()) {
		slimer.wait(100);
	}
}

interface Serving {
	name: string;
	value: string;
	units: string;
	date: Date;
}

function parseServings(page: WebPage, date: Date): Serving[] {
	return page
		.evaluate(() => {
			return Array.from(document.querySelectorAll('.servingsPanel tr:not(.prettyTable-header)'));
		})
		.map((tr) => {
			const tds = tr.querySelectorAll('td');
			return {
				name: tds[1].innerText.trim(),
				value: tds[2].innerText.trim(),
				units: tds[3].innerText.trim(),
				date: date
			};
		});
}

function saveJSON(path: string, data: any) {
	fs.write(path, JSON.stringify(data, undefined, 2), 'w');
}

function formatDate(d: Date): string {
	if (typeof d.getFullYear !== 'function') {
		console.log('[formatDate] Error: object is not a Date', JSON.stringify(d), d);
		return JSON.stringify(d);
	}
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function saveServingsCSV(path: string, data: Serving[]) {
	let csv = [] as Array<string>;
	csv.push('Date,Name,Value,Units');
	data.forEach((s) => {
		csv.push([formatDate(s.date), s.name, s.value, s.units].map((v) => JSON.stringify(v)).join(','));
	});
	fs.write(path, csv.join('\n'), 'w');
}

(() => {
	const scrapedDates = fs.list('data/').reduce(
		(dates, path) => {
			if (!path.endsWith('_servings.json')) {
				return dates;
			}
			const date = path.split('_')[0];
			dates[date] = JSON.parse(fs.read(`data/${path}`, 'r'));
			dates[date] = dates[date].map((s) => {
				s.date = new Date(s.date);
				return s;
			});
			return dates;
		},
		{} as { [key: string]: Serving[] }
	);

	const page = webpage.create();
	page.viewportSize = { width: 1080, height: 1600 };
	(async function() {
		let status = await page.open('https://cronometer.com/');
		if (status == 'success') {
			console.log('The title of the page is: ' + page.title);
		} else {
			console.log('Sorry, the page is not loaded');
			return;
		}

		let days = 20;
		let now = new Date();
		let date = new Date(now.getFullYear(), now.getMonth(), now.getDate());

		let allServings = [] as Array<Serving>;
		doLogin(page, env['USERNAME'], env['PASSWORD']);
		slimer.wait(1000);
		while (days-- > 0) {
			const name = formatDate(date);
			console.log('');
			console.log('Scraping data for ', name);
			if (scrapedDates[name]) {
				console.log('Using saved data for ', name);
				const servings = scrapedDates[name];
				allServings = allServings.concat(servings);
			} else {
				selectDate(page, date);
				takeSnapshot(page, name);

				console.log('Parsing servings for ', name);
				const servings = parseServings(page, date);
				saveJSON(`data/${name}_servings.json`, servings);
				allServings = allServings.concat(servings);
			}
			// go to previous date
			date = new Date(date.getTime() - 86400000);
		}

		saveServingsCSV(`data/all_servings.csv`, allServings);
	})().then(done(page), doneWithError(page));
})();
