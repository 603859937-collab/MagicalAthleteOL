from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AthleteCard:
    """Identity of one racer.

    Display text lives in the web bundle, keyed by the language-independent
    ``id``, so the server never carries a translation. Only `name` (the English
    card face from the rulebook) and the rules-engine handle are kept here.
    """

    id: str
    name: str
    engine_name: str

    def public_data(self) -> dict[str, str]:
        return {
            "id": self.id,
            "name": self.name,
        }


def card(athlete_id: str, name: str, engine_name: str | None = None) -> AthleteCard:
    return AthleteCard(athlete_id, name, engine_name or name.replace(" ", ""))


# Racer identities: rulebook pages 21-25. Card text lives in the web bundle.
ATHLETE_CATALOG = (
    card('alchemist', 'Alchemist'),
    card('baba_yaga', 'Baba Yaga', 'BabaYaga'),
    card('banana', 'Banana'),
    card('blimp', 'Blimp'),
    card('centaur', 'Centaur'),
    card('cheerleader', 'Cheerleader'),
    card('coach', 'Coach'),
    card('copycat', 'Copycat'),
    card('dicemonger', 'Dicemonger'),
    card('duelist', 'Duelist'),
    card('egg', 'Egg'),
    card('flip_flop', 'Flip Flop', 'FlipFlop'),
    card('genius', 'Genius'),
    card('gunk', 'Gunk'),
    card('hare', 'Hare'),
    card('heckler', 'Heckler'),
    card('huge_baby', 'Huge Baby', 'HugeBaby'),
    card('hypnotist', 'Hypnotist'),
    card('inchworm', 'Inchworm'),
    card('lackey', 'Lackey'),
    card('leaptoad', 'Leaptoad'),
    card('legs', 'Legs'),
    card('lovable_loser', 'Lovable Loser', 'LovableLoser'),
    card('magician', 'Magician'),
    card('mastermind', 'Mastermind'),
    card('mouth', 'Mouth'),
    card('party_animal', 'Party Animal', 'PartyAnimal'),
    card('romantic', 'Romantic'),
    card('rocket_scientist', 'Rocket Scientist', 'RocketScientist'),
    card('scoocher', 'Scoocher'),
    card('sisyphus', 'Sisyphus'),
    card('skipper', 'Skipper'),
    card('stickler', 'Stickler'),
    card('suckerfish', 'Suckerfish'),
    card('third_wheel', 'Third Wheel', 'ThirdWheel'),
    card('twin', 'Twin'),
)

ATHLETE_BY_ID = {athlete.id: athlete for athlete in ATHLETE_CATALOG}
