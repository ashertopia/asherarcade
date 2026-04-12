// ============================================================
// WALK THE WORD - Google Apps Script Companion
// ============================================================
// This script:
//   1. Reads your daily step total from Google Fit
//   2. Calculates your position on the Ephesus route
//   3. Sends vtext SMS when you cross a checkpoint
//   4. Sends a morning summary text each day at 7am
//
// SETUP:
//   1. Go to script.google.com
//   2. Create a new project, paste this entire file
//   3. Fill in YOUR_PHONE_NUMBER and YOUR_VTEXT_EMAIL below
//   4. Run setupTriggers() ONCE from the menu to activate
//   5. Authorize Google Fit access when prompted
//
// ============================================================

// ---- YOUR SETTINGS ----
const PHONE_NUMBER   = '6155551234';           // Your 10-digit Verizon number
const VTEXT_EMAIL    = '6155551234@vtext.com'; // Replace with your number
const YOUR_NAME      = 'Scott';                // Your first name
// -----------------------

const STEPS_PER_MILE = 2112;
const SHEET_NAME     = 'WalkTheWord';

// Checkpoint definitions (must match index.html)
const CHECKPOINTS = [
  { id: 'harbor',    name: 'The Harbor Gate',          milesIn: 0,    teaser: 'Paul has arrived in Ephesus. The Arcadian Way stretches before you.' },
  { id: 'theatre',   name: 'The Great Theatre',         milesIn: 2.0,  teaser: '24,000 voices. Two hours of chanting. The silversmith riot awaits.' },
  { id: 'agora',     name: 'The Commercial Agora',      milesIn: 4.5,  teaser: 'Paul worked leather here. The gospel spread between transactions.' },
  { id: 'celsus',    name: 'Library of Celsus',         milesIn: 7.0,  teaser: 'The third largest library in the Roman world. Knowledge vs. the Word.' },
  { id: 'curetes',   name: 'Curetes Way',               milesIn: 10.5, teaser: 'Seven sons of Sceva tried to cast out demons. It did not go well.' },
  { id: 'artemis',   name: 'Temple of Artemis',         milesIn: 13.5, teaser: 'One of the Seven Wonders. And Paul said it was nothing.' },
  { id: 'terrace',   name: 'The Terrace Houses',        milesIn: 16.5, teaser: 'The wealthy of Ephesus. And the house churches they hosted.' },
  { id: 'marychurch',name: "Church of Mary & Paul's Farewell", milesIn: 19.0, teaser: 'The beach farewell. The last time they saw him.' },
  { id: 'finish',    name: 'Journey Complete',           milesIn: 21.0, teaser: 'You walked with Paul through Ephesus. Well done.' }
];

// ============================================================
// TRIGGERS - Run setupTriggers() once to activate
// ============================================================
function setupTriggers() {
  // Delete existing triggers
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // Check steps every hour
  ScriptApp.newTrigger('hourlyCheck')
    .timeBased()
    .everyHours(1)
    .create();

  // Morning summary at 7am
  ScriptApp.newTrigger('morningSummary')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .create();

  Logger.log('Triggers set up. Walk the Word is active.');
}

// ============================================================
// HOURLY CHECK - runs every hour
// ============================================================
function hourlyCheck() {
  const totalSteps = getTotalStepsToday();
  const sheet      = getOrCreateSheet();
  const totalAll   = logDailySteps(sheet, totalSteps);
  const totalMiles = totalAll / STEPS_PER_MILE;

  // Check if we've crossed a new checkpoint since last check
  const lastMiles  = getLastLoggedMiles(sheet);
  checkAndAlertCheckpoints(lastMiles, totalMiles);
  updateLastLoggedMiles(sheet, totalMiles);
}

// ============================================================
// MORNING SUMMARY - runs at 7am
// ============================================================
function morningSummary() {
  const sheet      = getOrCreateSheet();
  const totalAll   = getTotalMilesFromSheet(sheet);
  const next       = getNextCheckpoint(totalAll);
  const yesterdaySteps = getYesterdaySteps(sheet);

  let msg = `Walk the Word - Good morning ${YOUR_NAME}! `;

  if (yesterdaySteps > 0) {
    const yesterdayMiles = (yesterdaySteps / STEPS_PER_MILE).toFixed(1);
    msg += `Yesterday: ${yesterdaySteps.toLocaleString()} steps (${yesterdayMiles} mi). `;
  }

  msg += `Total: ${totalAll.toFixed(1)} of 21.0 miles. `;

  if (next) {
    const milesLeft  = (next.milesIn - totalAll).toFixed(1);
    const stepsLeft  = Math.round(milesLeft * STEPS_PER_MILE);
    msg += `Next stop: ${next.name} in ${milesLeft} mi (${stepsLeft.toLocaleString()} steps). ${next.teaser}`;
  } else {
    msg += `Journey complete! Open the app to choose your next experience.`;
  }

  sendSMS(msg);
}

// ============================================================
// CHECKPOINT ALERTS
// ============================================================
function checkAndAlertCheckpoints(prevMiles, newMiles) {
  CHECKPOINTS.forEach(cp => {
    if (cp.milesIn > 0 && prevMiles < cp.milesIn && newMiles >= cp.milesIn) {
      const msg = `Walk the Word - You've arrived at ${cp.name}! ${cp.teaser} Open the app to see the full story.`;
      sendSMS(msg);
    }
  });
}

function getNextCheckpoint(miles) {
  return CHECKPOINTS.find(cp => miles < cp.milesIn) || null;
}

// ============================================================
// GOOGLE FIT INTEGRATION
// ============================================================
function getTotalStepsToday() {
  try {
    const now       = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    const response = Fitness.Users.Dataset.aggregate(
      { userId: 'me' },
      {
        aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: startOfDay.getTime(),
        endTimeMillis: now.getTime()
      }
    );

    let steps = 0;
    if (response.bucket && response.bucket.length > 0) {
      response.bucket.forEach(bucket => {
        if (bucket.dataset && bucket.dataset.length > 0) {
          bucket.dataset.forEach(ds => {
            if (ds.point) {
              ds.point.forEach(pt => {
                if (pt.value && pt.value.length > 0) {
                  steps += pt.value[0].intVal || 0;
                }
              });
            }
          });
        }
      });
    }
    return steps;
  } catch(e) {
    Logger.log('Google Fit error: ' + e.toString());
    return 0;
  }
}

// ============================================================
// SHEET STORAGE
// ============================================================
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() ||
             SpreadsheetApp.create('Walk the Word Data');
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange('A1:D1').setValues([['Date', 'Steps', 'CumulativeMiles', 'LastCheckedMiles']]);
  }
  return sheet;
}

function logDailySteps(sheet, steps) {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const data  = sheet.getDataRange().getValues();

  // Find today's row
  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === today) { rowIdx = i + 1; break; }
  }

  // Calculate total from all previous days
  let totalSteps = steps;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] !== today) totalSteps += (data[i][1] || 0);
  }

  const totalMiles = totalSteps / STEPS_PER_MILE;

  if (rowIdx > 0) {
    sheet.getRange(rowIdx, 2).setValue(steps);
    sheet.getRange(rowIdx, 3).setValue(totalMiles);
  } else {
    sheet.appendRow([today, steps, totalMiles, totalMiles]);
  }

  return totalMiles * STEPS_PER_MILE; // return total steps
}

function getTotalMilesFromSheet(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;
  return data[data.length - 1][2] || 0;
}

function getLastLoggedMiles(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;
  return data[data.length - 1][3] || 0;
}

function updateLastLoggedMiles(sheet, miles) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  sheet.getRange(data.length, 4).setValue(miles);
}

function getYesterdaySteps(sheet) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = Utilities.formatDate(yesterday, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === yKey) return data[i][1] || 0;
  }
  return 0;
}

// ============================================================
// SMS VIA VTEXT
// ============================================================
function sendSMS(message) {
  try {
    GmailApp.sendEmail(
      VTEXT_EMAIL,
      '',
      message.substring(0, 160)
    );
    Logger.log('SMS sent: ' + message.substring(0, 80));
  } catch(e) {
    Logger.log('SMS error: ' + e.toString());
  }
}

// ============================================================
// MANUAL TEST - Run this to test your SMS
// ============================================================
function testSMS() {
  sendSMS(`Walk the Word test message for ${YOUR_NAME}. If you got this, SMS is working.`);
}

// ============================================================
// ENABLE GOOGLE FIT API
// Run this function once to verify Fitness API is enabled.
// If it fails, go to:
// Extensions > Advanced Google services > Google Fitness API > Enable
// ============================================================
function checkFitnessAPIEnabled() {
  try {
    const test = Fitness.Users.Dataset.aggregate(
      { userId: 'me' },
      {
        aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: new Date().getTime() - 86400000,
        endTimeMillis: new Date().getTime()
      }
    );
    Logger.log('Fitness API working. Steps today: ' + JSON.stringify(test).substring(0, 200));
  } catch(e) {
    Logger.log('Fitness API error: ' + e.toString());
    Logger.log('Go to Extensions > Advanced Google Services and enable Google Fitness API.');
  }
}
