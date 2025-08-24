'use strict';

module.exports = {
    Client: require('./lib/Client'),
    auth: {
        BaseAuthStrategy: require('./lib/authStrategies/BaseAuthStrategy'),
        LocalAuth: require('./lib/authStrategies/LocalAuth'),
        RemoteAuth: require('./lib/authStrategies/RemoteAuth'),
        NoAuth: require('./lib/authStrategies/NoAuth'),
    },
    stores: {
        Store: require('./lib/util/Injected/Store'),
        AuthStore: require('./lib/util/Injected/AuthStore/AuthStore')
    },
    factories: {
        ChatFactory: require('./lib/structures').ChatFactory,
        ContactFactory: require('./lib/structures').ContactFactory,
    },
    structures: require('./lib/structures'),
    util: {
        Constants: require('./lib/util/Constants'),
        Util: require('./lib/util/Util'),
        Utils: require('./lib/Utils'),
        Puppeteer: require('./lib/util/Puppeteer'),
        InterfaceController: require('./lib/util/InterfaceController'),
    },
    webcache: {
        WebCache: require('./lib/webCache/WebCache'),
        LocalWebCache: require('./lib/webCache/LocalWebCache'),
        RemoteWebCache: require('./lib/webCache/RemoteWebCache'),
        WebCacheFactory: require('./lib/webCache/WebCacheFactory'),
    }
};