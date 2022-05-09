# Rewards Auto Compound

This scripts fetches a list of all Orbs stakers on Polygon and invokes "Claim" for each of them.
It also gathers and writes metrics.

### Running and debugging
* First, run `npm install`
* Add ENV variables or create a `.env` file with the following entries: 
  * `ADDRESS` : the address used to initiate the Claim method 
  * `PK` : The private key for this address
* While making changes during development, run `npm run dev` to re-build and execute the code.
* In production, after the code has been built, use `npm run start`.