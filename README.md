# Easy Start PG Backend for Making Mistakes

This is a simple API on top of PG.

The API allows you to:

* post JSON in to a partitioned log
* stream data out of the log (as it's POSTed in) as SSE


## Why is it for Making Mistakes?

Databases should belong to only one microservice. But that's a rule
everyone wants to break. This will make it even easier to do that.

Hey ho.

Maybe we should just play with things more.

But dangerous weapons can also be super tools.


## What about resilience?

Yeah. It's all coming.


## How does someone authenticate to the API?

There is a builtin keepie for the API.

So a service wishing to access this DB should register in the keepie.

### Are there other ways?

Yes. If you had a well known cloud platform that supplied you with
servers we might choose all the servers in a project.




## Todo

* generic query - you should be able to post a combinatorial query term and get back the matching result set
** but what is the query language?



## Testing

The tests here assert the following:

* the PostgreSQL works 
* the schema contains at least the log table
* the log can be inserted into
* inserts cause an event stream output that can be consumed
* the event stream can be consumed with Basic authentication
* the event streamed output is the same as the one inserted
* the top of the log is what has been inserted
* the necessary partitions are constructed on demand
* the log represents all partitions
* the partitions are date ordered most significant part first
* the last item of data in the most recent partition is the inserted row
* the API keepie sends correctly to a remote
* the PostgreSQL can be safely shut down

