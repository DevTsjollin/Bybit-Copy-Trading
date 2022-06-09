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

setInterval(async function () {
  var ts = new Date().getTime();
  const url = "https://api2.bybit.com/fapi/beehive/public/v1/common/order/list-detail?" + "leaderUserId=" + config.leaderUserId + "&timeStamp=" + ts;
  axios.get(url)
  .then(res => {
    var publicPositions = res.data.result.data;
    var ownPositions = JSON.parse(fs.readFileSync("./current.json"));
    var logs = JSON.parse(fs.readFileSync("./logs.json"));
    for (const publicPosition of publicPositions) {
      var exchangeCoin = publicPosition.symbol.substring(publicPosition.symbol.length - 4 );      
      if (exchangeCoin != "USDT" && config.onlyUSDT) continue;
      if (isBlackListed(publicPosition.symbol)) continue;
      if (publicPosition == undefined) continue;

      var newPosition = true;
      for (const ownPosition of ownPositions) {
        if (ownPosition == undefined) continue;
        if (JSON.stringify(ownPosition.side) == JSON.stringify(publicPosition.side) && JSON.stringify(ownPosition.symbol) == JSON.stringify(publicPosition.symbol) && JSON.stringify(ownPosition.publicEntryPrice) == JSON.stringify(publicPosition.entryPrice) && JSON.stringify(ownPosition.createdAtE3) == JSON.stringify(publicPosition.createdAtE3)) {
          newPosition = false;
        }
      }; 

      if (newPosition) {
        var dataObject = {};
        dataObject.side = publicPosition.side;
        dataObject.symbol = publicPosition.symbol;
        dataObject.leverage = Number(publicPosition.leverageE2) / 100;
        dataObject.publicEntryPrice = publicPosition.entryPrice;
        dataObject.createdAtE3 = publicPosition.createdAtE3;
        if (publicPosition.side == "Buy") {
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

          logs.push(`LONG OPENED | ${dataObject.symbol} | Entry: ${dataObject.publicEntryPrice} | Leverage: ${dataObject.leverage}x`)
        } else {
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

          logs.push(`SHORT OPENED | ${dataObject.symbol} | Entry: ${dataObject.publicEntryPrice} | Leverage: ${dataObject.leverage}x`)
        }
        ownPositions.push(dataObject);
      }
    }
    for (const [index, ownPosition] of ownPositions.entries()) {
      if (ownPosition == undefined) continue;

      var containsCurrent = false;  
      for (const publicPosition of publicPositions) {
        if (JSON.stringify(ownPosition.side) == JSON.stringify(publicPosition.side) && JSON.stringify(ownPosition.symbol) == JSON.stringify(publicPosition.symbol) && JSON.stringify(ownPosition.publicEntryPrice) == JSON.stringify(publicPosition.entryPrice) && JSON.stringify(ownPosition.createdAtE3) == JSON.stringify(publicPosition.createdAtE3)) {
          containsCurrent = true;
        }
      }

      if (!containsCurrent) {
        if (ownPosition.side == "Buy") {
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

          logs.push(`LONG CLOSED | ${ownPosition.symbol} | Entry: ${ownPosition.publicEntryPrice} | Leverage: ${ownPosition.leverage}x`)
        } else {
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

          logs.push(`SHORT CLOSED | ${ownPosition.symbol} | Entry: ${ownPosition.publicEntryPrice} | Leverage: ${ownPosition.leverage}x`)
        }
        ownPositions.splice(index, 1); // verwijder position uit current;
      }
    }
    fs.writeFileSync("./current.json", JSON.stringify(ownPositions, null, 2));
    fs.writeFileSync("./logs.json", JSON.stringify(logs, null, 2));
  })
  .catch(error => {
    console.error(error);
  });

}, config.updateDelay);

function isBlackListed(symbol) {
  for (const object of config.blacklist) { 
    if (object == symbol) {
      return true;
    }
  }
  return false;
}