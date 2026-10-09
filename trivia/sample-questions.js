/* Sample questions for the trivia order form's dropdowns. {name} becomes the
 * guest of honor's first name. The customer picks a question (or writes their
 * own), then types the right answer and three wrong ones.
 * Used by order.html and trivia-studio.html.
 */
(function (root) {
  'use strict';
  var Q = {
    'Growing up': [
      'What did {name} want to be when they grew up?',
      "What was {name}'s favorite toy as a kid?",
      "What was {name}'s first pet's name?",
      "What was {name}'s favorite cartoon or kids' show?",
      'Where was {name} born?',
      'What did {name} dress up as for a memorable Halloween?',
      "What was {name}'s childhood nickname?",
      'What food did {name} refuse to eat as a kid?',
      'How did {name} lose their first tooth?',
      "What was {name}'s favorite family vacation?"
    ],
    'Favorites': [
      "What is {name}'s favorite food?",
      "What is {name}'s go-to fast food order?",
      "What is {name}'s favorite movie?",
      "What is {name}'s favorite song right now?",
      "What is {name}'s favorite sports team?",
      "What is {name}'s favorite color?",
      "What is {name}'s favorite candy or snack?",
      "What is {name}'s favorite holiday?",
      'What does {name} always order at a coffee shop?',
      "What is {name}'s favorite TV show to binge?",
      "What is {name}'s favorite restaurant?",
      'What app does {name} spend the most time on?'
    ],
    'Personality': [
      'What is {name} most afraid of?',
      "What is {name}'s hidden talent?",
      "What is {name}'s biggest pet peeve?",
      'What would {name} do with a free Saturday?',
      'What does {name} always say?',
      'What is {name} most likely to be late for?',
      "What is {name}'s go-to karaoke song?",
      'What is the most "{name}" thing {name} has ever done?',
      'Who is {name} most likely to call first with big news?',
      'What is {name} secretly really good at?'
    ],
    'Milestones': [
      "What was {name}'s first job?",
      "What was {name}'s first car?",
      'How many times did {name} take the driving test?',
      "What is {name}'s proudest moment?",
      "What was {name}'s most embarrassing moment?",
      'Where is the farthest place {name} has traveled?',
      'What is something {name} has always wanted to try?'
    ],
    'Graduation': [
      "What was {name}'s favorite subject?",
      "Which teacher did {name} say changed their life?",
      'What activity or sport was {name} most involved in?',
      'Where is {name} headed next?',
      'What will {name} miss most about school?',
      'What did {name} get in trouble for at school?',
      "What was {name}'s lunch table known for?",
      'What is {name} planning to study or do next?'
    ],
    'Birthday': [
      'How old is {name} turning?',
      'What was the best birthday present {name} ever got?',
      "What is {name}'s birthday cake of choice?",
      "What was {name}'s most memorable birthday party?",
      'What is on top of {name}’s wish list this year?'
    ],
    'Couple': [
      'Where did {name} and their partner first meet?',
      'Where was their first date?',
      'Who said "I love you" first?',
      'Where did the proposal happen?',
      'Who is the better cook?',
      "What is the couple's favorite thing to do together?"
    ],
    'Family & retirement': [
      'How many years did {name} work at their job?',
      "What is {name}'s plan for retirement?",
      "What is {name}'s best piece of advice?",
      'What is the family recipe {name} is known for?',
      'Who in the family is {name} most like?'
    ]
  };
  // Which groups to show first for each occasion.
  var ORDER = {
    graduation: ['Graduation', 'Growing up', 'Favorites', 'Personality', 'Milestones'],
    birthday: ['Birthday', 'Growing up', 'Favorites', 'Personality', 'Milestones'],
    wedding: ['Couple', 'Favorites', 'Personality', 'Growing up', 'Milestones'],
    shower: ['Couple', 'Favorites', 'Personality', 'Growing up', 'Milestones'],
    anniversary: ['Couple', 'Family & retirement', 'Favorites', 'Personality', 'Milestones'],
    retirement: ['Family & retirement', 'Milestones', 'Favorites', 'Personality', 'Growing up'],
    custom: ['Favorites', 'Personality', 'Growing up', 'Milestones', 'Family & retirement']
  };
  function groupsFor(occasion) {
    return (ORDER[occasion] || ORDER.custom).map(function (g) { return { group: g, questions: Q[g] }; });
  }
  function fill(q, first) { return q.replace(/\{name\}/g, first || 'the guest of honor'); }
  var api = { groupsFor: groupsFor, fill: fill, all: Q };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TriviaSamples = api;
})(this);
