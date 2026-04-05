# the-road-prototype
Prototype for a board game to test game mechanisms

# to run locally
from terminal:python3 -m http.server
open browser to http://localhost:8000/index.html

# Game Rules

## Goal
You are a lonely traveler in a ruined world seeking out the shelter of the Sanctuary. Reach the sanctuary alive, sane, and human to win. 

## Setup
Set out the player board and the gather board and seperate out the following decks of cards:
- Loot cards: Separare these into three piles
  - The Road
  - The Sprawl
  - The Hive
- Threat cards: Separare these into three piles
  - The Road
  - The Sprawl
  - The Hive
- Mutation cards

Select a character. If the character starts with a card, search through The Road Loot cards and find the selected card. Place it next to your player board.

Shuffle and draw 30 cards from The Road Loot cards. This will be your "travel deck" and represents the loot you will find on your first leg of the journey. Place these next to the gather board. 

Throughout the game you will draw cards from the travel deck and place them on the gather board. When you can no longer draw cards from the travel deck, you move to the next location (i.e., the sprawl). When you reach the end of the Hive, you reach the sanctuary and win. 

Select a difficulty level. Using the reference sheet, player markers on the 4 tracks on the player board for food, health, sanity, and mutation. At the start of the game, the players food cannot be about 8. Select the "cost overlay" for The Road and the selected difficulty level and place it on the gather track. This represents the cost of selecting loot from that slot. 

## Turn order

On your turn, draw 5 cards from the travel deck and place them *in ascending order of card value* as shown on the loot card from left to right on the gather board, such that the "weakest" cards are on the left and the strongest on the right. 

Select 1 card to loot, then do the following in this order:

### 1. Pay costs

Pay the cost indicated on the slot. The most common cost is food. To pay the cost, move the marker on the player board *down* the corresponding number. If paying the cost causes the marker to reach the bottom of the track, take the appropriate action (see *player board effects* below).

### 2. Draw threats

Draw the number of threat cards indicated on the slot *one at a time.* There are three kinds of threats: breaks, setbacks, monsters. 

#### Breaks

You dodge danger... this time.

#### Setbacks

These cards effect the health, sanity, and mutation tracks. Move markers down the slot as indicated on the card and follow the instructions in *player board effects* if any marker reaches the bottom of its track. 

#### Monsters and battles

You enter a battle with the monster. Compare your strength with the strength of the monster. 

Calculate your strength as follows.
1. Find your *base strength* by finding your marker on the health track on the player board. The number to the right indicates the player strength. 
2. Modify your strength by your sanity. Look at the sanity track on the player board and look for the strength modifier.
3. (Optional) Add the strength of your equipped weapon, if you have one. If you use your weapon, remove a token from it. Weapons with no tokens cannot be used.

If your strength is greater than the monster's strength, you win. The monster is discarded and you get the loot.

If your strength is equal to that of the monster's strength, you tie. The monster is killed and you get the loot, but you also take damage as indicated on the monster card. 

If your strength is less than that of the monster, you lose and you immediately take damage. You *may* take one more desperate lunge to ty to get the loot. 

*One more desperate lunge:* Calculate the new strength of the now damaged monster by subracting your current strength from the original strength of the monster. Roll the die. *Do not take player strength into consideration.* If the die roll alone is greater than the monster's new strength, you get the loot. If it is tied, you get the loot but take damange. If it is less than, you take damage and do not get the loot. 

If you lose a battle, do not draw any more threat cards that turn.

#### Threat deck cleanup

All threat cards are discarded. If the threat deck is exhausted in a given location, reshuffle it. 

### 3. Get the loot!

There are four types of loot card. 

#### Gather cards

Adjust the player track based on the gather card, then place the card out of play. It will not be shuffled back into the deck.

#### Items

Place the item card into your inventory (any spot near the player board). You cannot have more than three items in your inventory at once. If you have three and collect a fourth, choose one to place out of play. If a card as a specific number of "uses" add tokens to the card. 

#### Weapons

Place the weapon in your inventory. You may only have one weapon at a time. Add tokens to the card based on the number of uses. 

#### Armor

Place the armor in your inventory. You may only have one *type* (head, body, accessory) of armor at a time. Add tokens to the armor based on the amount and type of damage it absorbs. 

Armor absorbs damage from threat cards or monsters. If you were to move your marker down a player track (health, sanity, mutation) you may instead remove token from the armor card associated with the damage type. When no tokens remain on the armor, it is destroyed and placed out of play.

#### 4. Cleanup

Any cards that were not selected are placed into a discard pile. Only cards removed from the gather board during the cleanup phase are moved into the discard pile. 

If, at this point, the travel deck is empty, move to the new location: see *entering a new location*. Otherwise, begin your next turn. 

## Player Board Effects

Perform the following actions immediately when it occurs. 

### Starvation

If the food player food track moves to 0 or otherwise cannot be moved to pay a food cost, move health and sanity down one. A player can still collect a card from the gather track that has a food cost even if they do not have food, but they experience starvation. 

### Death by injury

If the health track goes to 0, you immediately lose. 

### Madness

If the sanity track goes to 0, you immediately lose. 

### Mutation

If the mutation track moves to a slot with a mutation card icon, collect a mutation card.

#### Collecting mutation cards

Draw two cards from the mutation deck and select one. Mutation cards will give bonuses. A player can have no more than three mutation cards. 

### Mutation... but too far

If the mutation track goes to 10, you immediately lose. 

## Entering a new location

When you reach the end of The Road or the Sprawl, perform the following actions. 

Draw 9 cards from the deck of the next location. The order of locations is The Road, The Sprawl, and the Hive. 

From the 9 cards, select 6. Add those six cards to the travel deck discard pile. Shuffle all the cards together. This will be your new travel deck. There should always be 30 cards at the start of a new location (which corresponds to 6 turns/location).

## Winning

You win the game when you are in the hive and can no longer draw cards from the travel deck. 

## Cards

All cards can be found in catalog.html. Keep close track of how the cards impact things like strength, card cost, and other bonuses. 