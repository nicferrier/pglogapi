# Whither pglogapi?

This allows you to build a microservice that has a datastore.

* Microservices with datastores should scale
* Microservices should not compete on datastores; 1 microservice => 1 datastore
* All operations on a microservices datastore should go through the service's API
* Microservices should operate a secured datastore
* Micoservice APIs must know their consumers; this requires authorization

These 5 rules are very common microservice principles. But these are
relatively difficult to implement.

Scaling datastores is mostly a matter of paritioning data
correctly. This is difficult to template. So we choose a log api based
approach. See [below about scaling with log handling](#scaling-by-log-handling).

Competing on datastores is a common microservice antipattern. To avoid
it, build scalable API only microservices that presentation
microservices might call on. Separate data strongly between the
different microservice APIs. It is still possible to share data
between microservices with datastores by utilzing service level
subscription. See [sharing data with subscription](#sharing-data-with-subscription).

Operating a secured datastore could be achieved, perhaps, by settling
on a containerization technology. But this would be limiting. The
alternative is to properly secure the microservice's datastore and
expressly authorize the mircoservice to use it. We take that approach
here. See [Keepie for the internal datastore](#keepie-for-the-internal-datastore).

For any microservice to maintain a datastore, it should know it's
consumers. Unfettered access to a datastore API will result in
constraints around scaling. So some kind of API authorization schema
is necessary. See [Keepie for the public API](#keepie-for-the-public-api)

All these requirements add up to something rather complicated. But if
we can help developers follow them by providing good base technology
that takes some of the work away, then I believe we're really getting
there.

That's what this is for. It's not intended to be a framework so much
as scaffolding. In fact it simply builds on node's Express framework
for much of the web facing technology.

## Scaling by log handling

pglogapi provides a service wrapping a PostgreSQL that has one, time
sharded log table that can store JSON objects.

The API provides means of pushing data into the log and querying the
log.

Because a log is general purpose it *can* be sharded simply, with no
knowledge of the application.

Shards, or *partitions* in Postgres, could be distributed across
multiple database instances. Time based shards that are not current
can also be more efficiently stored: perhaps some entries removed.

In addition, the database can be used to normalize the log as it is
written, through the use of traditional trigger like code. This can be
executed every time something is added to the log, and then normalize
it into traditional relational store.

The sharding of the relational store, along with the normalization
from the log, can be safely left to the implementor.

Scaling relational state therefore is aided by these facilities:

* code can be triggered by log insert and normalize log entries into relational state
* relational state can be hydrated from the log
* relational state can be stored in archives synchronized with the log

## Sharing data with subscription

To be waffled about.


## Keepie for the internal datastore

I prefer not to alight on one containerization strategy. Without it we
must install a database server and defend it from other code on our
server. Or even in the container in which we place the server.

If the database server is secured how does the microservice gain
access to it? We shouldn't place a secure token, either a password or
a certificate key, in the codebase.

The answer, is to build the code to start the server and change it's
password on startup, with the service owning the password. Defending
that password is then defending it on the disc. That can be done
relatively well with unix permissioning or chroot or cgroups.

For this to work effectively I use
[Keepie](https://github.com/nicferrier/keepie) which is a
URL/HTTP-callback based authorization protocol. Keepie allows a
PostgreSQL db to be started, the password changed, and the
authorization to get at that password to be granted to local code.

## Keepie for the public API

If an API is to provide datastore facilities such as entering data in
the log or querying the log, such access should be authorized. If it
is not there is no possibility of knowing consumers. There is a chance
consumers will overload the datastore, or put the wrong data in it.

Because of this, all the API that pglogapi provides, is protected with
basic authentication. The password can be generated randomly at
startup, or via a timer event.

A Keepie API provides access to the authentication token. The Keepie
has controllable authorization details, but basically they are files
with the authorized urls in.

This is somewhat complicated, because we have two different types of
Keepie going on. One for internal access to the datastore, which is
almost totally hidden from the pglogapi code, and one for external
access to the pg log API. But this is still the best way to do it.
