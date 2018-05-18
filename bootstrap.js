//no need to create namespace, we are in a sandbox

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/Task.jsm");
Components.utils.import("resource://gre/modules/osfile.jsm");

let window = null;

//Observer to catch loading of thunderbird main window
let onLoadObserver = {
    observe: function(aSubject, aTopic, aData) {        
        if (window === null) {
            window = Services.wm.getMostRecentWindow("mail:3pane");
            if (window) {
                //init TbSync
                tbSync.init(window); 
            } else {
                tbSync.dump("FAIL", "Could not init TbSync, because mail:3pane window not found.");
            }
        }
    }
}

let onLoadDoneObserver = {
    observe: function(aSubject, aTopic, aData) {        
        forEachOpenWindow(loadIntoWindow);  
        Services.wm.addListener(WindowListener);    
    }
}




function install(data, reason) {
}

function uninstall(data, reason) {
}

function startup(data, reason) {
    //possible reasons: APP_STARTUP, ADDON_ENABLE, ADDON_INSTALL, ADDON_UPGRADE, or ADDON_DOWNGRADE.

    //set default prefs
    let branch = Services.prefs.getDefaultBranch("extensions.tbsync.");
    branch.setCharPref("clientID.type", "");
    branch.setCharPref("clientID.useragent", "");    
    branch.setBoolPref("notify4beta", false);
    branch.setIntPref("updateCheckInterval", 6);
    
    branch.setCharPref("provider.eas", "Exchange Active Sync");
    branch.setCharPref("provider.dav", "CalDAV/CardDAV (sabre/dav, ownCloud, Nextcloud)");

    branch.setBoolPref("log.toconsole", false);
    branch.setBoolPref("log.tofile", false);
    branch.setBoolPref("log.easdata", true);

    branch.setIntPref("eas.timeout", 90000);
    branch.setIntPref("eas.synclimit", 7);
    branch.setIntPref("eas.maxitems", 50);

    //tzpush
    branch.setBoolPref("eas.use_tzpush_contactsync_code", true);
    branch.setBoolPref("hidephones", false);
    branch.setBoolPref("showanniversary", false);

    Components.utils.import("chrome://tbsync/content/tbsync.jsm");

    //Map local writeAsyncJSON into tbSync
    tbSync.writeAsyncJSON = writeAsyncJSON;
    
    //add startup observers
    Services.obs.addObserver(onLoadObserver, "mail-startup-done", false);
    Services.obs.addObserver(onLoadObserver, "tbsync.init", false);
    Services.obs.addObserver(onLoadDoneObserver, "tbsync.init.done", false);

    if (reason != APP_STARTUP) {
        //during startup, we wait until mail-startup-done fired, for all other reasons we need to fire our own init
        Services.obs.notifyObservers(null, 'tbsync.init', null)
    }
    
    //DO NOT ADD ANYTHING HERE!
    //The final init of TbSync was triggered by issuing a "tbsync.init". If that is done, it will issue a "tbsync.init.done".
    //So if there is stuff to do after init is done, add it at the local onLoadDoneObserver
}

function shutdown(data, reason) {
    //possible reasons: APP_SHUTDOWN, ADDON_DISABLE, ADDON_UNINSTALL, ADDON_UPGRADE, or ADDON_DOWNGRADE    

    //remove startup observer
    Services.obs.removeObserver(onLoadObserver, "mail-startup-done");
    Services.obs.removeObserver(onLoadObserver, "tbsync.init");
    Services.obs.removeObserver(onLoadDoneObserver, "tbsync.init.done");
	
    //call cleanup of the tbSync module
    forEachOpenWindow(unloadFromWindow);
    Services.wm.removeListener(WindowListener);
    tbSync.cleanup();
    
    //abort write timers and write current file content to disk 
    if (tbSync.enabled) {
        tbSync.db.changelogTimer.cancel();
        tbSync.db.accountsTimer.cancel();
        tbSync.db.foldersTimer.cancel();
        writeAsyncJSON(tbSync.db.accounts, tbSync.db.accountsFile);
        writeAsyncJSON(tbSync.db.folders, tbSync.db.foldersFile);
        writeAsyncJSON(tbSync.db.changelog, tbSync.db.changelogFile);
    }

    //unload tbSync module
    tbSync.dump("TbSync shutdown","Unloading TbSync module.");
    Components.utils.unload("chrome://tbsync/content/tbsync.jsm");

    // HACK WARNING:
    //  - the Addon Manager does not properly clear all addon related caches on update;
    //  - in order to fully update images and locales, their caches need clearing here
    Services.obs.notifyObservers(null, "chrome-flush-caches", null);

}





function forEachOpenWindow(todo)  // Apply a function to all open windows
{
    var windows = Services.wm.getEnumerator(null);
    while (windows.hasMoreElements()) {
        todo(windows.getNext().QueryInterface(Components.interfaces.nsIDOMWindow));
    }
}

function loadIntoWindow(window) {
/* call/move your UI construction function here */
    //if (window.document.getElementById("abcardWindow")) window.alert("juh");
}

function unloadFromWindow(window) {
/* call/move your UI tear down function here */
}

var WindowListener =
{
    onOpenWindow: function(xulWindow)
    {
        var window = xulWindow.QueryInterface(Components.interfaces.nsIInterfaceRequestor).getInterface(Components.interfaces.nsIDOMWindow);
        function onWindowLoad()
        {
            window.removeEventListener("load", onWindowLoad);
            loadIntoWindow(window);
        }
        window.addEventListener("load", onWindowLoad);
    },
    onCloseWindow: function(xulWindow) { },
    onWindowTitleChange: function(xulWindow, newTitle) { }
};





function writeAsyncJSON (obj, filename) {
    let filepath = tbSync.getAbsolutePath(filename);
    let storageDirectory = tbSync.storageDirectory;
    let json = tbSync.encoder.encode(JSON.stringify(obj));
    
    //no tbSync function/methods inside spawn, because it could run after tbSync was unloaded
    Task.spawn(function* () {
        //MDN states, instead of checking if dir exists, just create it and catch error on exist (but it does not even throw)
        yield OS.File.makeDir(storageDirectory);
        yield OS.File.writeAtomic(filepath, json, {tmpPath: filepath + ".tmp"});
    }).catch(Components.utils.reportError);
}