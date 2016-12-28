'use strict'
const Wechat = require('../../index')
const IContact = require('../../src/interface/contact')
const debug = require('debug')('wxbot')
const MongoClient = require('mongodb').MongoClient
const mongoUrl = 'mongodb://localhost:27017/uuke'
const assert = require('assert')
const resemble = require('node-resemble-v2')
let DB = undefined

class WxBot extends Wechat {

  constructor() {
    super()

    this.memberInfoList = []

    this.replyUsers = new Set()
    this.on('message', msg => {
      if (msg.MsgType == this.CONF.MSGTYPE_TEXT) {
        this._botReply(msg)
      }
    })

    this.superviseUsers = new Set()
    this.openTimes = 0
    this.on('message', msg => {
      if (msg.MsgType == this.CONF.MSGTYPE_STATUSNOTIFY) {
        this._botSupervise()
      }
    })

    this.on('error', err => debug(err))

    this._initMongoDB()
  }

  get replyUsersList() {
    return this.friendList.map(member => {
      member.switch = this.replyUsers.has(member['UserName'])
      return member
    })
  }

  get superviseUsersList() {
    return this.friendList.map(member => {
      member.switch = this.superviseUsers.has(member['UserName'])
      return member
    })
  }

  _initMongoDB () {
    MongoClient.connect(mongoUrl, function(err, db) {
      if (err === null) DB = db
      else debug(err)
    })
  }

  _tuning(word) {
    let params = {
      'key': '2ba083ae9f0016664dfb7ed80ba4ffa0',
      'info': word
    }
    return this.request({
      method: 'GET',
      url: 'http://www.tuling123.com/openapi/api',
      params: params
    }).then(res => {
      let data = res.data
      if (data.code === 100000) {
        return data.text + '[微信机器人]'
      }
      throw new Error('tuning返回值code错误', data)
    }).catch(err => {
      debug(err)
      return '现在思路很乱，最好联系下我哥 T_T...'
    })
  }

  _botReply(msg) {
    if (this.replyUsers.has(msg['FromUserName'])) {
      this._tuning(msg['Content']).then(reply => {
        this.sendText(reply, msg['FromUserName'])
        debug(reply)
      })
    }
  }

  _botSupervise() {
    const message = '我的主人玩微信' + ++this.openTimes + '次啦！'
    for (let user of this.superviseUsers.values()) {
      this.sendMsg(message, user)
      debug(message)
    }
  }

  // override updateContacts so that we can link a wechat user to uuke users
  updateContacts(contacts) {
    contacts.forEach(contact => {
      if (this.contacts[contact.UserName]) {
        let original = this.contacts[contact.UserName].__proto__
        for (let i in contact) {
          contact[i] || delete contact[i]
        }
        Object.assign(original, contact)
        this.contacts[contact.UserName].init(this)
      } else {
        let contactObj = this.Contact.extend(contact)
        this.contacts[contact.UserName] = contactObj
        if ( !IContact.isSpContact(contactObj)
          && !IContact.isPublicContact(contactObj)
          && !IContact.isRoomContact(contactObj)
          && !contactObj.RemarkName.startsWith('UUKE_ID_')) {
          this.getHeadImg(contactObj.HeadImgUrl).then(res => {
            this._linkContactToUUKEAccount(contactObj, res.data)
          }).catch (err => {
            debug(err)
            throw new Error('获取头像失败: ' + contactObj.NickName)
          })
        }
      }
    })
    this.emit('contacts-updated', contacts)
  }

  // For a new wechat contact, we will match it with a uuke user by its NickName & HeadImgUrl
  // And then set its RemarkName as UUKE_ID_xxx, xxx is _id of the user in mongoDB
  _linkContactToUUKEAccount(contact, headImg) {
    var _this = this;
    let collection = DB.collection('users');
    // Find some documents
    collection.find({name:contact.NickName}).toArray(function(err, users) {
      assert.equal(err, null)
      if (users.length !== 0) { // should match more fields
        users.map(user => {
          _this.request({
            method: 'GET',
            url: user.portrait,
            responseType: 'arraybuffer'
          }).then(res => {
            if (res.status === 200) {
              resemble(headImg).compareTo(res.data).scaleToSameSize().onComplete(function(data){
                let misMatchPercentage = parseFloat(data.misMatchPercentage)
                if (misMatchPercentage < 1.0) {
                  let remarkName = 'UUKE_ID_' + user._id
                  _this.updateRemarkName(contact.UserName, remarkName).then(ret => {
                    contact.RemarkName = remarkName
                  })
                }
              })
            }
          }).catch(err => {
            debug(err)
            throw new Error('获取UUKE用户头像失败: ' + user['name'])
          })
        })
      }
      else {
        // TODO: this doesn't mean that the contact isn't a uuke user, in case that user changes NickName but our mongodb hasn't updated yet
        debug(contact.NickName + 'might not be uuke user')
      }
    });
  }
}

exports = module.exports = WxBot
