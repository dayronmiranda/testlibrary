'use strict';

exports.LoadWriteOnlyUtils = () => {
    window.WWebJS.forwardMessage = async (chatId, msgId) => {
        throw new Error('Read-only mode: forwardMessage is disabled');
    };

    window.WWebJS.sendSeen = async (chatId) => {
        throw new Error('Read-only mode: sendSeen is disabled');
    };

    window.WWebJS.sendMessage = async (chat, content, options = {}) => {
        throw new Error('Read-only mode: sendMessage is disabled');
    };

    window.WWebJS.editMessage = async (msg, content, options = {}) => {
        throw new Error('Read-only mode: editMessage is disabled');
    };

    window.WWebJS.toStickerData = async (mediaInfo) => {
        throw new Error('Read-only mode: toStickerData is disabled');
    };

    window.WWebJS.processStickerData = async (mediaInfo) => {
        throw new Error('Read-only mode: processStickerData is disabled');
    };

    window.WWebJS.processMediaData = async (mediaInfo, options) => {
        throw new Error('Read-only mode: processMediaData is disabled');
    };

    window.WWebJS.sendClearChat = async (chatId) => {
        throw new Error('Read-only mode: sendClearChat is disabled');
    };

    window.WWebJS.sendDeleteChat = async (chatId) => {
        throw new Error('Read-only mode: sendDeleteChat is disabled');
    };

    window.WWebJS.sendChatstate = async (state, chatId) => {
        throw new Error('Read-only mode: sendChatstate is disabled');
    };

    window.WWebJS.rejectCall = async (peerJid, id) => {
        throw new Error('Read-only mode: rejectCall is disabled');
    };

    window.WWebJS.setPicture = async (chatId, media) => {
        throw new Error('Read-only mode: setPicture is disabled');
    };

    window.WWebJS.deletePicture = async (chatid) => {
        throw new Error('Read-only mode: deletePicture is disabled');
    };

    window.WWebJS.membershipRequestAction = async (groupId, action, requesterIds, sleep) => {
        throw new Error('Read-only mode: membershipRequestAction is disabled');
    };

    window.WWebJS.subscribeToUnsubscribeFromChannel = async (channelId, action, options = {}) => {
        throw new Error('Read-only mode: subscribeToUnsubscribeFromChannel is disabled');
    };

    window.WWebJS.pinUnpinMsgAction = async (msgId, action, duration) => {
        throw new Error('Read-only mode: pinUnpinMsgAction is disabled');
    };
};