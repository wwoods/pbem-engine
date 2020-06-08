pbem-engine
-----------

Ever wanted to make a game you can play with your friends, but not wanted to deal with the hassle of network code?  `pbem-engine` is designed to handle network communications in a principled manner, allowing developers to focus on game code.  The engine supports any game or software which may be implemented as a simultaneous, asynchronous turn-based game.


Setup
=====

1. Install docker
2. Run "docker run --rm couchdb:2.3.1"


Running a PWA
=============

(This section under construction; saving notes later for this).

`pbem-engine` is designed for the creation of ![Progressive Web Applications](https://developers.google.com/web/progressive-web-apps).  That means that whatever games are made may be run in the browser, or downloaded to a user's phone or other device.

*If you only want to test your application, running it in development mode, forwarding the appropriate ports, and sharing your IP address with friends should be sufficient.*  However, for production, you'll need HTTPS support, or users will not be able to install your PWA onto a device.  This is required as it additionally secures your application and protects your users.  The most economical and straightforward way of doing this involves:

1. A free, dynamic DNS service such as ![No-IP](https://www.noip.com).  This allows you to point a webservice name, such as "mygame.ddns.net", towards a computer you have access to.

2. An HTTPS certificate.  ![wmnnd/nginx-certbot](https://github.com/wmnnd/nginx-certbot/) is a helpful repository.

3. That should be it?


Housekeeping
============

Notes:

* In `tsconfig.json`, `lib: "dom"` was added until https://github.com/DefinitelyTyped/DefinitelyTyped/issues/36082 is resolved.

TODO:

* When remote game starts, there's an index error...
* Allow actions to opt-out of wait-for-network behavior (game can specify default mode of user-space actions).
