const config = require('./config.json');
const fs = require("fs");
const axios = require('axios');
const { Webhook, MessageBuilder } = require('discord-webhook-node');
const { LinearClient } = require('bybit-api');

const hook = new Webhook(config.discordWebhook);

const client = new LinearClient(
  config.bybit.APIKEY,
  config.bybit.APISECRET,
  true // uselivenet
);

var loopIndex = 0;

setInterval(async function () {
  var ts = new Date().getTime();
  const url = "https://api2.bybit.com/fapi/beehive/public/v1/common/order/list-detail?" + "leaderUserId=" + config.leaderUserId + "&timeStamp=" + ts;
  axios.get(url)
  .then(res => {
    var publicPositions = res.data.result.data;
    handleData(publicPositions);
  })
  .catch(error => {
    console.error(error);
  });
}, config.updateDelay);

async function handleData(publicPositions) {
  var ownPositions = JSON.parse(fs.readFileSync("./current.json"));
  var logs = JSON.parse(fs.readFileSync("./logs.json"));
  for await (const publicPosition of publicPositions) {
    var exchangeCoin = publicPosition.symbol.substring(publicPosition.symbol.length - 4 );      
    if (exchangeCoin != "USDT" && config.onlyUSDT) continue;
    if (publicPosition == undefined) continue;

    var newPosition = true;
    for await (const ownPosition of ownPositions) {
      if (ownPosition == undefined) continue;
      if (JSON.stringify(ownPosition.side) == JSON.stringify(publicPosition.side) && JSON.stringify(ownPosition.symbol) == JSON.stringify(publicPosition.symbol) && JSON.stringify(ownPosition.publicEntryPrice) == JSON.stringify(publicPosition.entryPrice) && JSON.stringify(ownPosition.createdAtE3) == JSON.stringify(publicPosition.createdAtE3)) {
        newPosition = false;
      }
    }; 

    if (newPosition) {
      var dataObject = {};
      dataObject.side = publicPosition.side;
      dataObject.symbol = publicPosition.symbol;
      dataObject.hisLeverage = Number(publicPosition.leverageE2) / 100;
      dataObject.leverage = config.leverage;
      dataObject.publicEntryPrice = publicPosition.entryPrice;
      dataObject.createdAtE3 = publicPosition.createdAtE3;
      dataObject.firstStart = false;
      if (publicPosition.side == "Buy") {
        var markPrice = await getMarkPrice(publicPosition.symbol);
        var accountBalance = await getAvailableBalance() *2;
        var ourAmountUSDT = calcPercentage(accountBalance, config.entryAmountPercentage);
        var ourAmount = makePrecision(ourAmountUSDT / markPrice);

        var params = {
          side: "Buy", 
          symbol: dataObject.symbol, 
          order_type: "Market", 
          qty: ourAmount, 
          time_in_force: "GoodTillCancel", 
          reduce_only: false, 
          close_on_trigger: false
        }
        if (!config.firstStart) {
          logs.push(`LONG OPENED | ${dataObject.symbol} | Entry: ${dataObject.publicEntryPrice} | Leverage: ${dataObject.leverage}x`);

          await client.setMarginSwitch({symbol: dataObject.symbol, is_isolated: true, buy_leverage: config.leverage, sell_leverage: config.leverage});
          if (!config.debug) {
            var request = await client.placeActiveOrder(params);
            console.log(request);

            dataObject.size = request.result.qty;
            dataObject.order_id = request.result.order_id;  
          }
          const embed = new MessageBuilder()
          .setTitle(`Long Opened`)
          .setURL(`https://www.bybit.com/trade/usdt/${dataObject.symbol}`)
          .addField('Symbol', `${dataObject.symbol}`, true)
          .addField('Entry', `${dataObject.publicEntryPrice}`, true)
          .addField('Leverage', `${dataObject.leverage}x`, true)
          .setColor('#24ae64')
          .setThumbnail('https://i.ibb.co/sHs8C4q/LONG.png')
          .setTimestamp();
          if (config.everyoneTag) {
            embed.setText("@everyone");
          }
          hook.send(embed);
        } else {
          dataObject.firstStart = true;
        }
      } else {
        var markPrice = await getMarkPrice(publicPosition.symbol);
        var accountBalance = await getAvailableBalance();
        var ourAmountUSDT = calcPercentage(accountBalance, config.entryAmountPercentage);
        var ourAmount = makePrecision(ourAmountUSDT / markPrice);
        
        var params = {
          side: "Sell", 
          symbol: dataObject.symbol, 
          order_type: "Market", 
          qty: ourAmount, 
          time_in_force: "GoodTillCancel", 
          reduce_only: false, 
          close_on_trigger: false
        }

        if (!config.firstStart) {
          logs.push(`SHORT OPENED | ${dataObject.symbol} | Entry: ${dataObject.publicEntryPrice} | Leverage: ${dataObject.leverage}x`);

          await client.setMarginSwitch({symbol: dataObject.symbol, is_isolated: true, buy_leverage: config.leverage, sell_leverage: config.leverage});
          if (!config.debug) {
            var request = await client.placeActiveOrder(params);
            console.log(request);

            dataObject.size = request.result.qty;
            dataObject.order_id = request.result.order_id;
          }

          const embed = new MessageBuilder()
          .setTitle(`Short Opened`)
          .setURL(`https://www.bybit.com/trade/usdt/${dataObject.symbol}`)
          .addField('Symbol', `${dataObject.symbol}`, true)
          .addField('Entry', `${dataObject.publicEntryPrice}`, true)
          .addField('Leverage', `${dataObject.leverage}x`, true)
          .setColor('#e04040')
          .setThumbnail('https://i.ibb.co/9sKPgCW/SHORT.png')
          .setTimestamp();
          if (config.everyoneTag) {
            embed.setText("@everyone");
          }
          hook.send(embed);
        } else {
          dataObject.firstStart = true;
        }
      }
      ownPositions.push(dataObject);
    }
  }
  for await (const [index, ownPosition] of ownPositions.entries()) {
    if (ownPosition == undefined) continue;

    var containsCurrent = false;  
    for await (const publicPosition of publicPositions) {
      if (JSON.stringify(ownPosition.side) == JSON.stringify(publicPosition.side) && JSON.stringify(ownPosition.symbol) == JSON.stringify(publicPosition.symbol) && JSON.stringify(ownPosition.publicEntryPrice) == JSON.stringify(publicPosition.entryPrice) && JSON.stringify(ownPosition.createdAtE3) == JSON.stringify(publicPosition.createdAtE3)) {
        containsCurrent = true;
      }
    }

    if (!containsCurrent) {
      if (ownPosition.side == "Buy") {
        var params = {
          side: "Sell", 
          symbol: ownPosition.symbol, 
          order_type: "Market", 
          qty: ownPosition.size, 
          time_in_force: "GoodTillCancel", 
          reduce_only: true, 
          close_on_trigger: false
        }

        if (!ownPosition.firstStart) {
          if (!config.debug) {
            var request = await client.placeActiveOrder(params);
            console.log(request);
          }
          logs.push(`LONG CLOSED | ${ownPosition.symbol} | Entry: ${ownPosition.publicEntryPrice} | Leverage: ${ownPosition.leverage}x`);

          const embed = new MessageBuilder()
          .setTitle(`Long Closed`)
          .setURL(`https://www.bybit.com/trade/usdt/${ownPosition.symbol}`)
          .addField('Symbol', `${ownPosition.symbol}`, true)
          .addField('Entry', `${ownPosition.entryPrice}`, true)
          .addField('Mark', `${ownPosition.markPrice}`, true)
          .addField('PNL', `${ownPosition.pnl}`, true)
          .addField('ROE', `${ownPosition.roe}`, true)
          .addField('Leverage', `${ownPosition.leverage}x`, true)
          .setColor('#0000FF')
          .setThumbnail('https://i.ibb.co/sHs8C4q/LONG.png')
          .setTimestamp();
          if (config.everyoneTag) {
            embed.setText("@everyone");
          }
          hook.send(embed);
        }
      } else {
        var params = {
          side: "Buy", 
          symbol: ownPosition.symbol, 
          order_type: "Market", 
          qty: ownPosition.size, 
          time_in_force: "GoodTillCancel", 
          reduce_only: true, 
          close_on_trigger: false
        }

        if (!ownPosition.firstStart) {
          if (!config.debug) {
            var request = await client.placeActiveOrder(params);
            console.log(request);
          }
          logs.push(`SHORT CLOSED | ${ownPosition.symbol} | Entry: ${ownPosition.publicEntryPrice} | Leverage: ${ownPosition.leverage}x`);

          const embed = new MessageBuilder()
          .setTitle(`Short Closed`)
          .setURL(`https://www.bybit.com/trade/usdt/${ownPosition.symbol}`)
          .addField('Symbol', `${ownPosition.symbol}`, true)
          .addField('Entry', `${ownPosition.entryPrice}`, true)
          .addField('Mark', `${ownPosition.markPrice}`, true)
          .addField('PNL', `${ownPosition.pnl}`, true)
          .addField('ROE', `${ownPosition.roe}`, true)
          .addField('Leverage', `${ownPosition.leverage}x`, true)
          .setColor('#0000FF')
          .setThumbnail('https://i.ibb.co/9sKPgCW/SHORT.png')
          .setTimestamp();
          if (config.everyoneTag) {
            embed.setText("@everyone");
          }
          hook.send(embed);
        }
      }
      ownPositions.splice(index, 1); // verwijder position uit current;
    }
  }
  console.log("Loop completed  #" + loopIndex);
  loopIndex++;
  fs.writeFileSync("./current.json", JSON.stringify(ownPositions, null, 2));
  fs.writeFileSync("./logs.json", JSON.stringify(logs, null, 2));
}

async function getAvailableBalance() {
  var balance = await client.getWalletBalance({coin: "USDT"});
  return balance.result.USDT.available_balance;
}

async function getMarkPrice(asset) {
  var request = await client.getTickers({symbol: asset});
  return request.result[0].mark_price;
}

function calcPercentage(balance, percentage) {
  return (Number(balance) / 100) * Number(percentage)
}
function makePrecision(quantity) {
  return Math.ceil(quantity * 100000000) / 100000000;
}