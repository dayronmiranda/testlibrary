'use strict';

module.exports = {
    Client: require('./lib/Client'),
    auth: {
        BaseAuthStrategy: require('./lib/BaseAuthStrategy'),
        LocalAuth: require('./lib/LocalAuth'),
        RemoteAuth: require('./lib/RemoteAuth'),
        NoAuth: require('./lib/NoAuth'),
    },
    stores: {
        Store: require('./lib/Store'),
        AuthStore: require('./lib/AuthStore')
    },
    factories: {
        ChatFactory: require('./lib/ChatFactory'),
        ContactFactory: require('./lib/ContactFactory'),
    },
    structures: require('./lib/structures'),
    util: {
        Constants: require('./lib/Constants'),
        Util: require('./lib/Util'),
        Utils: require('./lib/Utils'),
        Puppeteer: require('./lib/Puppeteer'),
        InterfaceController: require('./lib/InterfaceController'),
    },
    webcache: {
        WebCache: require('./lib/WebCache'),
        LocalWebCache: require('./lib/LocalWebCache'),
        RemoteWebCache: require('./lib/RemoteWebCache'),
        WebCacheFactory: require('./lib/WebCacheFactory'),
    }
};