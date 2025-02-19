'use strict'

const debug = require('debug')('bfx:hf:strategy:position:close-with-order')
const _isObject = require('lodash/isObject')
const _isFunction = require('lodash/isFunction')

const getDefaultSymbol = require('../data/get_default_symbol')
const submitTrade = require('../orders/submit_trade')
const validateOrderParams = require('../orders/validate_order_params')
const updatePositionWithTrade = require('../data/update_position_with_trade')
const { calcRealizedPositionPnl } = require('../pnl')

/**
 * Closes an open position with an order. Throws an error if no position is open
 * for the order's symbol.
 *
 * @param {Object} state
 * @param {Object} orderParams
 * @return {Promise} p - resolves to nextState
 */
const closePositionWithOrder = async (state = {}, orderParams = {}) => {
  const { positions, onPositionClose, onOrderFill, backtesting, emit } = state
  const symbol = orderParams.symbol || getDefaultSymbol(state)

  if (!orderParams.symbol) {
    orderParams.symbol = symbol
  }

  const {
    [symbol]: prevPosition,
    ...otherPositions // NOTE: Used as next positions map!
  } = positions

  if (!_isObject(prevPosition)) {
    throw new Error('no position is currently open')
  } else if (prevPosition.amount + orderParams.amount !== 0) {
    throw new Error(`order would not close position (pos for ${prevPosition.amount})`)
  }

  validateOrderParams(state, orderParams)

  let nextState = state
  const { order, trade } = await submitTrade(nextState, orderParams)

  const positionData = updatePositionWithTrade(prevPosition, trade)
  positionData.closingPrice = trade.price
  positionData.closedAt = Date.now()

  if (!backtesting) {
    if (_isFunction(onOrderFill)) {
      nextState = await onOrderFill(nextState, {
        order,
        trade
      })
    }
  }

  if (_isFunction(onPositionClose)) {
    nextState = await onPositionClose(nextState, {
      position: positionData,
      order,
      trade
    })
  }

  if (!backtesting) {
    debug('CLOSE %s @ %f | %s | PL %f', symbol, order.priceAvg, order.type, trade.realizedPnl.toString())
  }

  if (_isFunction(emit)) {
    emit('closed_position_data', {
      ...positionData,
      realizedPnl: calcRealizedPositionPnl(positionData),
      unrealizedPnl: 0
    })
  }

  return {
    ...nextState,
    positions: otherPositions,
    closedPositions: [
      ...nextState.closedPositions || [],
      positionData
    ],
    trades: [
      ...nextState.trades,
      trade
    ]
  }
}

module.exports = closePositionWithOrder
