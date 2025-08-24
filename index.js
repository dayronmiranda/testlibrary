'use strict';

module.exports = {
    Client: require('./src/Client'),
    auth: {
        BaseAuthStrategy: require('./src/BaseAuthStrategy'),
        LocalAuth: require('./src/LocalAuth'),
        RemoteAuth: require('./src/RemoteAuth'),
        NoAuth: require('./src/NoAuth'),
    },
    stores: {
        Store: require('./src/Store'),
        AuthStore: require('./src/AuthStore')
    },
    factories: {
        ChatFactory: require('./src/ChatFactory'),
        ContactFactory: require('./src/ContactFactory'),
    },
    structures: require('./src/structures'),
    util: {
        Constants: require('./src/Constants'),
        Util: require('./src/Util'),
        Utils: require('./src/Utils'),
        Puppeteer: require('./src/Puppeteer'),
        InterfaceController: require('./src/InterfaceController'),
    },
    webcache: {
        WebCache: require('./src/WebCache'),
        LocalWebCache: require('./src/LocalWebCache'),
        RemoteWebCache: require('./src/RemoteWebCache'),
        WebCacheFactory: require('./src/WebCacheFactory'),
    }
};