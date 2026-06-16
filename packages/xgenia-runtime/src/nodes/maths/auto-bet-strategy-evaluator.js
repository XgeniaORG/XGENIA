'use strict';

const AutoBetStrategyEvaluatorNode = {
  name: 'Auto Bet Strategy Evaluator',
  docs: 'https://docsapp.xgenia.com/nodes/math/auto-bet-strategy-evaluator',
  category: 'Math',
  color: 'data',
  description: 'Evaluates if auto bet should stop based on profit/loss and calculates the next bet amount.',
  searchTags: ['auto', 'bet', 'strategy', 'evaluator', 'profit', 'loss'],
  initialize: function () {
    this._internal.shouldContinue = false;
    this._internal.nextBetAmount = 0;
    this._internal.roundsPlayed = 0;
    this._internal.sessionProfitLoss = 0;
  },
  inputs: {
    'Do': {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.calculate();
      }
    },
    'Reset': {
      type: 'signal',
      displayName: 'Reset',
      group: 'Actions',
      valueChangedToTrue: function () {
        this._internal.roundsPlayed = 0;
        this._internal.sessionProfitLoss = 0;
        this._internal.shouldContinue = false;
        this._internal.nextBetAmount = 0;
      }
    },
    'last win amount': { type: 'number', defaultValue: 0 },
    'last bet amount': { type: 'number', defaultValue: 0 },
    'base bet': { type: 'number', defaultValue: 1 },
    'max rounds': { type: 'number', defaultValue: 0 },
    'stop on profit': { type: 'number', defaultValue: 0 },
    'stop on loss': { type: 'number', defaultValue: 0 },
    'increase bet on loss %': { type: 'number', defaultValue: 0 },
    'increase bet on win %': { type: 'number', defaultValue: 0 }
  },
  outputs: {
    'next bet amount': { type: 'number', getter: function () { return this._internal.nextBetAmount; } },
    'should continue': { type: 'boolean', getter: function () { return this._internal.shouldContinue; } },
    'Done': { type: 'signal', displayName: 'Done' }
  },
  methods: {
    calculate: function () {
      try {
        const lastWin = this.getInputValue('last win amount') || 0;
        const lastBet = this.getInputValue('last bet amount') || 0;
        const baseBet = this.getInputValue('base bet') || 1;
        const maxRounds = this.getInputValue('max rounds') || 0;
        const stopProfit = this.getInputValue('stop on profit') || 0;
        const stopLoss = this.getInputValue('stop on loss') || 0;
        const incLossPct = this.getInputValue('increase bet on loss %') || 0;
        const incWinPct = this.getInputValue('increase bet on win %') || 0;

        this._internal.roundsPlayed++;
        const netWin = lastWin - lastBet;
        this._internal.sessionProfitLoss += netWin;

        let cont = true;

        if (maxRounds > 0 && this._internal.roundsPlayed >= maxRounds) {
          cont = false;
        }
        if (stopProfit > 0 && this._internal.sessionProfitLoss >= stopProfit) {
          cont = false;
        }
        if (stopLoss > 0 && this._internal.sessionProfitLoss <= -stopLoss) {
          cont = false;
        }

        let nextBet = baseBet;
        if (lastBet > 0) {
            if (netWin > 0 && incWinPct > 0) {
                nextBet = lastBet * (1 + (incWinPct / 100));
            } else if (netWin < 0 && incLossPct > 0) {
                nextBet = lastBet * (1 + (incLossPct / 100));
            } else {
                nextBet = lastBet;
            }
        }

        this._internal.nextBetAmount = nextBet;
        this._internal.shouldContinue = cont;

        this.flagOutputDirty('next bet amount');
        this.flagOutputDirty('should continue');
        this.sendSignalOnOutput('Done');

      } catch (error) {
        console.error('Auto Bet Strategy Evaluator error:', error);
      }
    }
  }
};

module.exports = AutoBetStrategyEvaluatorNode;
